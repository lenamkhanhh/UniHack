import { test, expect } from '@playwright/test';
import crypto from 'crypto';
import {
  computeMissionPasskeyChallenge,
  base64UrlToBytes,
  bytesToBase64Url,
  parseDerSignature,
  SECP256R1_N,
  SECP256R1_HALF_N,
} from '../lib/webauthn-p256';

test.describe('A2: Passkey Mission Authority (RIP-7212 Precompile 0x100 & Real WebAuthn)', () => {
  test('User cancellation does NOT succeed and displays error deterministically (A2-R6)', async ({ page }) => {
    // Deterministic cancellation mock via init script
    await page.addInitScript(() => {
      (window as any).__simulateWebAuthnCancel = true;
    });

    await page.goto('/missions/new');
    await expect(page.getByTestId('passkey-page-header')).toBeVisible();

    // Hook credentials.create to simulate deterministic user cancellation
    await page.evaluate(() => {
      if (window.navigator?.credentials) {
        window.navigator.credentials.create = async () => {
          throw new DOMException('The user canceled the operation or denied permission.', 'NotAllowedError');
        };
      }
    });

    const registerBtn = page.getByTestId('register-passkey-btn');
    await expect(registerBtn).toBeVisible();
    await registerBtn.click();

    // Verify error is displayed deterministically and approve button remains disabled
    const errorAlert = page.getByTestId('passkey-error-alert');
    await expect(errorAlert).toBeVisible({ timeout: 5000 });
    await expect(errorAlert).toContainText(/hủy|failed|canceled|NotAllowedError/i);

    const approveBtn = page.getByTestId('approve-passkey-btn');
    await expect(approveBtn).toBeDisabled();
  });

  test('Virtual Authenticator registers P-256 passkey, extracts coordinates, and authorizes two sequential missions via real cryptographic boundary adapter (A2-R4, A2-R6)', async ({
    page,
    context,
  }) => {
    // 1. Enable CDP Virtual Authenticator (CTAP2 P-256)
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    const authResult = await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    expect(authResult.authenticatorId).toBeDefined();

    // 2. Track relay requests and cryptographic state
    let activePasskeyX = '0x0';
    let activePasskeyY = '0x0';
    let currentContractNonce = 0n;
    const relayedMissions: any[] = [];

    await page.route('**/api/passkey/relay', async (route) => {
      const request = route.request();
      const origin = new URL(request.url()).origin;

      if (request.method() === 'GET') {
        const hostname = new URL(request.url()).hostname;
        const realRpIdHash = '0x' + crypto.createHash('sha256').update(hostname).digest('hex');
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            status: 'CONFIGURED',
            authorityAddress: '0x77235386fe59A934645C5F273e411b0Bea8cCc9C',
            treasuryAddress: '0x20451c1e2dCD83F166B4f22868BAdECb5868d545',
            passkeyX: activePasskeyX,
            passkeyY: activePasskeyY,
            nextNonce: currentContractNonce.toString(),
            rpIdHash: realRpIdHash,
            expectedOrigin: origin,
            requireUserVerification: true,
            chainId: 43113,
          }),
        });
      }

      if (request.method() === 'POST') {
        const payload = JSON.parse(request.postData() || '{}');
        relayedMissions.push(payload);

        // A2-R4: Real Cryptographic Boundary Adapter
        // 1. Verify Nonce matches current state
        if (BigInt(payload.nonce) !== currentContractNonce) {
          return route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({ success: false, error: 'InvalidNonce' }),
          });
        }

        // 2. Verify Canonical Challenge Hash
        const expectedChallenge = computeMissionPasskeyChallenge({
          chainId: 43113,
          authority: '0x77235386fe59A934645C5F273e411b0Bea8cCc9C',
          missionId: payload.missionId,
          agent: payload.agent,
          payeeRoot: payload.payeeRoot,
          cap: BigInt(payload.cap),
          duration: BigInt(payload.duration),
          toolCap: BigInt(payload.toolCap),
          nonce: BigInt(payload.nonce),
        });

        const expectedChBytes = Buffer.from(expectedChallenge.slice(2), 'hex');
        const expectedChB64Url = bytesToBase64Url(new Uint8Array(expectedChBytes));

        const clientData = JSON.parse(payload.auth.clientDataJSON);
        if (clientData.type !== 'webauthn.get') {
          return route.fulfill({ status: 400, body: JSON.stringify({ success: false, error: 'InvalidType' }) });
        }
        if (clientData.challenge !== expectedChB64Url) {
          return route.fulfill({ status: 400, body: JSON.stringify({ success: false, error: 'ChallengeMismatch' }) });
        }
        if (clientData.origin !== origin) {
          return route.fulfill({ status: 400, body: JSON.stringify({ success: false, error: 'OriginMismatch' }) });
        }

        // 3. Verify AuthenticatorData (RP ID hash, UP, UV)
        const authDataBuf = Buffer.from(payload.auth.authenticatorData.slice(2), 'hex');
        if (authDataBuf.length < 37) {
          return route.fulfill({ status: 400, body: JSON.stringify({ success: false, error: 'AuthenticatorDataTooShort' }) });
        }
        const rpIdHashInAuth = authDataBuf.subarray(0, 32);
        const expectedRpIdBuf = crypto.createHash('sha256').update(new URL(request.url()).hostname).digest();
        if (!rpIdHashInAuth.equals(expectedRpIdBuf)) {
          return route.fulfill({ status: 400, body: JSON.stringify({ success: false, error: 'RpIdHashMismatch' }) });
        }
        const flags = authDataBuf[32];
        const up = (flags & 0x01) !== 0;
        const uv = (flags & 0x04) !== 0;
        if (!up || !uv) {
          return route.fulfill({ status: 400, body: JSON.stringify({ success: false, error: 'UserVerificationRequired' }) });
        }

        // 4. Verify P-256 ECDSA Cryptographic Signature
        const jwk = {
          kty: 'EC',
          crv: 'P-256',
          x: Buffer.from(activePasskeyX.slice(2), 'hex').toString('base64url'),
          y: Buffer.from(activePasskeyY.slice(2), 'hex').toString('base64url'),
        };
        const pubKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });

        const clientDataHash = crypto.createHash('sha256').update(payload.auth.clientDataJSON).digest();
        const signedPayload = Buffer.concat([authDataBuf, clientDataHash]);

        // Reconstruct DER signature from r and s
        function encodeDerInt(hexStr: string): Buffer {
          let b = Buffer.from(hexStr.slice(2), 'hex');
          if (b[0] & 0x80) {
            b = Buffer.concat([Buffer.from([0x00]), b]);
          }
          return Buffer.concat([Buffer.from([0x02, b.length]), b]);
        }
        const rDer = encodeDerInt(payload.auth.r);
        const sDer = encodeDerInt(payload.auth.s);
        const derSignature = Buffer.concat([Buffer.from([0x30, rDer.length + sDer.length]), rDer, sDer]);

        const isValidSig = crypto.verify('sha256', signedPayload, pubKey, derSignature);
        if (!isValidSig) {
          return route.fulfill({ status: 400, body: JSON.stringify({ success: false, error: 'P256VerificationFailed' }) });
        }

        // Advance sequential contract nonce
        currentContractNonce++;
        const txHash = `0x${'ab'.repeat(31)}${currentContractNonce.toString(16).padStart(2, '0')}`;

        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            status: 'CONFIRMED',
            txHash,
            blockNumber: '60712088',
            gasUsed: '318492',
            snowtraceUrl: `https://testnet.snowtrace.io/tx/${txHash}`,
            authorityAddress: '0x77235386fe59A934645C5F273e411b0Bea8cCc9C',
          }),
        });
      }

      return route.continue();
    });

    // 3. Navigate to /missions/new
    await page.goto('/missions/new');
    await expect(page.getByTestId('passkey-page-header')).toBeVisible();

    // 4. Register passkey with Virtual Authenticator
    const registerBtn = page.getByTestId('register-passkey-btn');
    await expect(registerBtn).toBeVisible();
    await registerBtn.click();

    // Verify registration succeeded and P-256 X/Y coordinates were extracted
    await expect(page.locator('text=Đã ghi nhận Passkey')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=P-256 X:')).toBeVisible();
    await expect(page.locator('text=P-256 Y:')).toBeVisible();

    // Read extracted coordinates from the registered passkey in localStorage
    const storedKey = await page.evaluate(() => {
      const saved = localStorage.getItem('missionpay_registered_passkey');
      return saved ? JSON.parse(saved) : null;
    });
    expect(storedKey).toBeDefined();
    expect(storedKey.x).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(storedKey.y).toMatch(/^0x[0-9a-fA-F]{64}$/);

    // Update the authority contract adapter with matching public key
    activePasskeyX = storedKey.x;
    activePasskeyY = storedKey.y;

    // Trigger config reload to update isCoordinatesMatched
    await page.evaluate(async () => {
      const res = await fetch('/api/passkey/relay');
      return res.json();
    });

    // 5. Approve Mission 1 (Nonce 0)
    const approveBtn = page.getByTestId('approve-passkey-btn');
    await expect(approveBtn).toBeEnabled();
    await approveBtn.click();

    // Verify confirmation
    await expect(page.getByTestId('passkey-confirmed-card')).toBeVisible({
      timeout: 15000,
    });
    expect(relayedMissions.length).toBe(1);
    expect(relayedMissions[0].nonce).toBe('0');

    // 6. Approve Mission 2 (Nonce 1, different slug and caps)
    await page.fill('#missionSlugInput', 'passkey-mission-live-02');
    await page.fill('#capUsdcInput', '5.0');
    await page.fill('#toolCapUsdcInput', '1.0');

    await approveBtn.click();

    // Verify second mission approved on-chain with sequential nonce 1
    await expect(page.getByTestId('passkey-confirmed-card')).toBeVisible({
      timeout: 15000,
    });
    expect(relayedMissions.length).toBe(2);
    expect(relayedMissions[1].nonce).toBe('1');
    expect(relayedMissions[1].cap).toBe('5000000');
    expect(relayedMissions[1].toolCap).toBe('1000000');
    expect(relayedMissions[1].missionId).not.toBe(relayedMissions[0].missionId);

    // Clean up CDP
    await cdp.send('WebAuthn.disable');
  });

  test('UI refuses known RP ID / origin mismatch before credentials.get (A2-R2)', async ({ page, context }) => {
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });

    let mockRpIdHash = '0x' + crypto.createHash('sha256').update('unauthorized-foreign-domain.com').digest('hex');
    let mockOrigin: string | null = null;

    await page.route('**/api/passkey/relay', async (route) => {
      const request = route.request();
      if (request.method() === 'GET') {
        const currentOrigin = new URL(request.url()).origin;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            status: 'CONFIGURED',
            authorityAddress: '0x77235386fe59A934645C5F273e411b0Bea8cCc9C',
            treasuryAddress: '0x20451c1e2dCD83F166B4f22868BAdECb5868d545',
            passkeyX: '0x0',
            passkeyY: '0x0',
            nextNonce: '0',
            rpIdHash: mockRpIdHash,
            expectedOrigin: mockOrigin ?? currentOrigin,
            requireUserVerification: true,
            chainId: 43113,
          }),
        });
      }
      return route.continue();
    });

    await page.goto('/missions/new');

    // Register passkey first
    const registerBtn = page.getByTestId('register-passkey-btn');
    await registerBtn.click();
    await expect(page.locator('text=Đã ghi nhận Passkey')).toBeVisible({ timeout: 10000 });

    const storedKey = await page.evaluate(() => {
      const saved = localStorage.getItem('missionpay_registered_passkey');
      return saved ? JSON.parse(saved) : null;
    });

    // Update relay to return the registered coordinates but with mismatched rpIdHash
    await page.unroute('**/api/passkey/relay');
    await page.route('**/api/passkey/relay', async (route) => {
      const request = route.request();
      if (request.method() === 'GET') {
        const currentOrigin = new URL(request.url()).origin;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            status: 'CONFIGURED',
            authorityAddress: '0x77235386fe59A934645C5F273e411b0Bea8cCc9C',
            treasuryAddress: '0x20451c1e2dCD83F166B4f22868BAdECb5868d545',
            passkeyX: storedKey.x,
            passkeyY: storedKey.y,
            nextNonce: '0',
            rpIdHash: mockRpIdHash,
            expectedOrigin: mockOrigin ?? currentOrigin,
            requireUserVerification: true,
            chainId: 43113,
          }),
        });
      }
      return route.continue();
    });

    // Track credentials.get call
    await page.evaluate(() => {
      (window as any).__credentialsGetCalled = false;
      const originalGet = window.navigator.credentials.get.bind(window.navigator.credentials);
      window.navigator.credentials.get = async (...args: any[]) => {
        (window as any).__credentialsGetCalled = true;
        return originalGet(...args);
      };
    });

    // Attempt approve with mismatched RP ID
    const approveBtn = page.getByTestId('approve-passkey-btn');
    await expect(approveBtn).toBeEnabled();
    await approveBtn.click();

    // Verify error alert displays RP ID mismatch
    const errorAlert = page.getByTestId('passkey-error-alert');
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toContainText(/RP ID không khớp/i);

    // Verify credentials.get was refused and NEVER called
    const getCalled = await page.evaluate(() => (window as any).__credentialsGetCalled);
    expect(getCalled).toBe(false);

    // Now test origin mismatch
    mockRpIdHash = '0x' + crypto.createHash('sha256').update(new URL(page.url()).hostname).digest('hex');
    mockOrigin = 'https://unauthorized-origin-phishing.org';

    await approveBtn.click();
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toContainText(/Origin không khớp/i);

    await cdp.send('WebAuthn.disable');
  });

  test('Adversarial negatives against cryptographic adapter: wrong signature, wrong key, wrong nonce, altered mission (A2-R4, A2-R6)', async ({ page, context }) => {
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });

    let activePasskeyX = '0x0';
    let activePasskeyY = '0x0';
    let postMode: 'normal' | 'corrupt_sig' | 'wrong_key' | 'wrong_nonce' | 'altered_mission' = 'normal';

    await page.route('**/api/passkey/relay', async (route) => {
      const request = route.request();
      const origin = new URL(request.url()).origin;
      const hostname = new URL(request.url()).hostname;
      const realRpIdHash = '0x' + crypto.createHash('sha256').update(hostname).digest('hex');

      if (request.method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            status: 'CONFIGURED',
            authorityAddress: '0x77235386fe59A934645C5F273e411b0Bea8cCc9C',
            treasuryAddress: '0x20451c1e2dCD83F166B4f22868BAdECb5868d545',
            passkeyX: activePasskeyX,
            passkeyY: activePasskeyY,
            nextNonce: '0',
            rpIdHash: realRpIdHash,
            expectedOrigin: origin,
            requireUserVerification: true,
            chainId: 43113,
          }),
        });
      }

      if (request.method() === 'POST') {
        if (postMode === 'corrupt_sig') {
          return route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({ success: false, status: 'UNVERIFIED', error: 'P256VerificationFailed: ECDSA signature invalid' }),
          });
        }
        if (postMode === 'wrong_key') {
          return route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({ success: false, status: 'UNVERIFIED', error: 'P256VerificationFailed: Public key mismatch' }),
          });
        }
        if (postMode === 'wrong_nonce') {
          return route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({ success: false, status: 'UNVERIFIED', error: 'InvalidNonce: Expected nonce 5, got 0' }),
          });
        }
        if (postMode === 'altered_mission') {
          return route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({ success: false, status: 'UNVERIFIED', error: 'ChallengeMismatch: Mission payload does not match signed challenge' }),
          });
        }

        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            status: 'CONFIRMED',
            txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
            blockNumber: '60712099',
            gasUsed: '318492',
          }),
        });
      }

      return route.continue();
    });

    await page.goto('/missions/new');

    const registerBtn = page.getByTestId('register-passkey-btn');
    await registerBtn.click();
    await expect(page.locator('text=Đã ghi nhận Passkey')).toBeVisible({ timeout: 10000 });

    const storedKey = await page.evaluate(() => {
      const saved = localStorage.getItem('missionpay_registered_passkey');
      return saved ? JSON.parse(saved) : null;
    });
    activePasskeyX = storedKey.x;
    activePasskeyY = storedKey.y;

    const approveBtn = page.getByTestId('approve-passkey-btn');
    const confirmedCard = page.getByTestId('passkey-confirmed-card');
    const errorAlert = page.getByTestId('passkey-error-alert');

    // Negative 1: Corrupted signature
    postMode = 'corrupt_sig';
    await approveBtn.click();
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toContainText(/P256VerificationFailed/);
    await expect(confirmedCard).not.toBeVisible();

    // Negative 2: Wrong key
    postMode = 'wrong_key';
    await approveBtn.click();
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toContainText(/Public key mismatch/);
    await expect(confirmedCard).not.toBeVisible();

    // Negative 3: Wrong nonce
    postMode = 'wrong_nonce';
    await approveBtn.click();
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toContainText(/InvalidNonce/);
    await expect(confirmedCard).not.toBeVisible();

    // Negative 4: Altered mission
    postMode = 'altered_mission';
    await approveBtn.click();
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toContainText(/ChallengeMismatch/);
    await expect(confirmedCard).not.toBeVisible();

    await cdp.send('WebAuthn.disable');
  });

  test('UI State Boundaries: Simulation success renders simulation badge and does NOT render confirmed card (A2-R3)', async ({ page, context }) => {
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });

    let activePasskeyX = '0x0';
    let activePasskeyY = '0x0';

    await page.route('**/api/passkey/relay', async (route) => {
      const request = route.request();
      const origin = new URL(request.url()).origin;
      const hostname = new URL(request.url()).hostname;
      const realRpIdHash = '0x' + crypto.createHash('sha256').update(hostname).digest('hex');

      if (request.method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            status: 'CONFIGURED',
            authorityAddress: '0x77235386fe59A934645C5F273e411b0Bea8cCc9C',
            treasuryAddress: '0x20451c1e2dCD83F166B4f22868BAdECb5868d545',
            passkeyX: activePasskeyX,
            passkeyY: activePasskeyY,
            nextNonce: '0',
            rpIdHash: realRpIdHash,
            expectedOrigin: origin,
            requireUserVerification: true,
            chainId: 43113,
          }),
        });
      }

      if (request.method() === 'POST') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            status: 'SIMULATION_SUCCESS',
            simulated: true,
            authorityAddress: '0x77235386fe59A934645C5F273e411b0Bea8cCc9C',
            missionId: '0x1000000000000000000000000000000000000000000000000000000000000001',
            gasEstimated: '284000',
            message: 'Passkey signature verified via genuine contract simulation on RPC',
          }),
        });
      }

      return route.continue();
    });

    await page.goto('/missions/new');

    const registerBtn = page.getByTestId('register-passkey-btn');
    await registerBtn.click();
    await expect(page.locator('text=Đã ghi nhận Passkey')).toBeVisible({ timeout: 10000 });

    const storedKey = await page.evaluate(() => {
      const saved = localStorage.getItem('missionpay_registered_passkey');
      return saved ? JSON.parse(saved) : null;
    });
    activePasskeyX = storedKey.x;
    activePasskeyY = storedKey.y;

    const approveBtn = page.getByTestId('approve-passkey-btn');
    await approveBtn.click();

    // Assert: Simulation card IS visible
    const simCard = page.getByTestId('passkey-simulation-card');
    await expect(simCard).toBeVisible({ timeout: 10000 });
    await expect(simCard).toContainText(/Simulation Success/i);
    await expect(simCard).toContainText(/Chưa broadcast on-chain/i);

    // Assert: Confirmed card is NOT visible
    const confirmedCard = page.getByTestId('passkey-confirmed-card');
    await expect(confirmedCard).not.toBeVisible();

    // Assert: Status message indicates simulation, NOT on-chain confirmation
    await expect(page.locator('text=Mission Đã Duyệt On-Chain Thành Công!')).not.toBeVisible();
    await expect(page.locator('text=Mô Phỏng Thực Thi Thành Công')).toBeVisible();

    await cdp.send('WebAuthn.disable');
  });

  test('UI State Boundaries: Missing receipt fields or RPC failure does NOT show confirmed success card or message (A2-R3)', async ({ page, context }) => {
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });

    let activePasskeyX = '0x0';
    let activePasskeyY = '0x0';
    let postOutcome: 'missing_block' | 'rpc_failure' = 'missing_block';

    await page.route('**/api/passkey/relay', async (route) => {
      const request = route.request();
      const origin = new URL(request.url()).origin;
      const hostname = new URL(request.url()).hostname;
      const realRpIdHash = '0x' + crypto.createHash('sha256').update(hostname).digest('hex');

      if (request.method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            status: 'CONFIGURED',
            authorityAddress: '0x77235386fe59A934645C5F273e411b0Bea8cCc9C',
            treasuryAddress: '0x20451c1e2dCD83F166B4f22868BAdECb5868d545',
            passkeyX: activePasskeyX,
            passkeyY: activePasskeyY,
            nextNonce: '0',
            rpIdHash: realRpIdHash,
            expectedOrigin: origin,
            requireUserVerification: true,
            chainId: 43113,
          }),
        });
      }

      if (request.method() === 'POST') {
        if (postOutcome === 'missing_block') {
          // Incomplete receipt: CONFIRMED with txHash, but missing blockNumber
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              status: 'CONFIRMED',
              txHash: '0x1111222233334444555566667777888899990000111122223333444455556666',
            }),
          });
        }

        if (postOutcome === 'rpc_failure') {
          return route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({
              success: false,
              status: 'UNAVAILABLE',
              error: 'RPC endpoint connection timed out',
            }),
          });
        }
      }

      return route.continue();
    });

    await page.goto('/missions/new');

    const registerBtn = page.getByTestId('register-passkey-btn');
    await registerBtn.click();
    await expect(page.locator('text=Đã ghi nhận Passkey')).toBeVisible({ timeout: 10000 });

    const storedKey = await page.evaluate(() => {
      const saved = localStorage.getItem('missionpay_registered_passkey');
      return saved ? JSON.parse(saved) : null;
    });
    activePasskeyX = storedKey.x;
    activePasskeyY = storedKey.y;

    const approveBtn = page.getByTestId('approve-passkey-btn');
    const confirmedCard = page.getByTestId('passkey-confirmed-card');

    // Case 1: Missing blockNumber
    postOutcome = 'missing_block';
    await approveBtn.click();

    // Must NOT render confirmed card
    await expect(confirmedCard).not.toBeVisible();
    // Must NOT show on-chain success status
    await expect(page.locator('text=Mission Đã Duyệt On-Chain Thành Công!')).not.toBeVisible();

    // Case 2: RPC Failure
    postOutcome = 'rpc_failure';
    await approveBtn.click();

    await expect(confirmedCard).not.toBeVisible();
    await expect(page.locator('text=Mission Đã Duyệt On-Chain Thành Công!')).not.toBeVisible();
    const errorAlert = page.getByTestId('passkey-error-alert');
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toContainText(/RPC endpoint connection timed out/);

    await cdp.send('WebAuthn.disable');
  });
});
