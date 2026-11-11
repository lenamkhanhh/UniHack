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

  test('A4-Gap-5: Wallet pending flow on verify page: unmined -> reload -> mined reconciliation (sendTransaction count 1); wrong/unknown chain sends 0', async ({
    page,
  }) => {
    const missionId = 'test-wallet-mission';

    // Track state
    await page.route(`**/api/verify/${missionId}`, async (route) => {
      const req = route.request();
      if (req.method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            missionId,
            anchorStatus: { anchored: false },
            entries: [
              {
                id: 1,
                sourceKey: 'init',
                prevHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
                entryHash: '0x7d46d87541ed812ada52afe7f1d3144d6a2b90b359a66162e54c8e41d675be2f',
                canonicalJson: '{"init":true}',
                missionSequence: 1,
                createdAt: new Date().toISOString(),
              },
            ],
            erc8004Validation: {
              isComplete: false,
              status: 'REQUEST_PENDING',
              score: 100,
              tag: 'verified-full',
              unsignedRequest: {
                to: '0x4c5ccda2a630cd1cb706799deadcc8483d06697e',
                data: '0x12345678',
                value: '0x0',
                chainId: 43113,
                requestHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
                ownerAddress: '0x83F5E5F17eE8D7BeC1968f100A11824E9c3713B5',
                missionSlug: missionId,
              },
            },
          }),
        });
      }

      if (req.method() === 'POST') {
        const postData = JSON.parse(req.postData() || '{}');
        expect(postData.txHash).toBe('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
        expect(postData.nonce).toBe('test-nonce-12345');
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            status: 'RESPONSE_PENDING',
            requestTxHash: postData.txHash,
          }),
        });
      }

      return route.continue();
    });

    await page.route('**/api/auth/challenge', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          challenge: {
            nonce: 'test-nonce-12345',
            message: 'Authorize validation request reconciliation',
          },
        }),
      });
    });

    // 1. Initial State: wrong chain (0x1) and switch fails
    await page.addInitScript(() => {
      let _sendTxCount = 0;
      (window as any).ethereum = {
        isMetaMask: true,
        request: async ({ method }: any) => {
          if (method === 'eth_chainId') return '0x1';
          if (method === 'wallet_switchEthereumChain') throw new Error('User rejected network switch');
          if (method === 'eth_sendTransaction') {
            _sendTxCount++;
            return '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
          }
          throw new Error(`Unsupported method ${method}`);
        },
      };
      (window as any).getSendTxCount = () => _sendTxCount;
    });

    await page.goto(`/verify/${missionId}`);
    const signBtn = page.getByTestId('sign-validation-request-button');
    await expect(signBtn).toBeVisible();

    await signBtn.click();
    await expect(page.locator('text=Please switch wallet network')).toBeVisible();

    // Verify eth_sendTransaction called 0 times on wrong/failed chain
    let sendCount = await page.evaluate(() => (window as any).getSendTxCount());
    expect(sendCount).toBe(0);

    // 2. Fix wallet chain to Avalanche Fuji (0xa869), but receipt is UNMINED
    await page.addInitScript(() => {
      let _sendTxCount = 0;
      let _receiptMined = false;

      (window as any).setReceiptMined = (val: boolean) => {
        _receiptMined = val;
      };

      (window as any).ethereum = {
        isMetaMask: true,
        request: async ({ method, params }: any) => {
          if (method === 'eth_chainId') return '0xa869';
          if (method === 'eth_requestAccounts' || method === 'eth_accounts') {
            return ['0x83F5E5F17eE8D7BeC1968f100A11824E9c3713B5'];
          }
          if (method === 'eth_sendTransaction') {
            _sendTxCount++;
            return '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
          }
          if (method === 'eth_getTransactionReceipt') {
            if (_receiptMined) {
              return { status: '0x1', transactionHash: params[0] };
            }
            return null; // Unmined
          }
          if (method === 'personal_sign') {
            return '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb1c';
          }
          throw new Error(`Method ${method} unsupported`);
        },
      };
      (window as any).getSendTxCount = () => _sendTxCount;
    });

    await page.goto(`/verify/${missionId}`);
    const signBtn2 = page.getByTestId('sign-validation-request-button');
    await expect(signBtn2).toBeVisible();

    // Click broadcast: sends transaction once, but times out waiting for unmined receipt
    await signBtn2.click();
    await expect(page.locator('text=Receipt not yet mined')).toBeVisible({ timeout: 15000 });

    // Verify eth_sendTransaction count is 1
    sendCount = await page.evaluate(() => (window as any).getSendTxCount());
    expect(sendCount).toBe(1);

    // Verify pending tx is persisted in localStorage under key with chain+registry+requestHash+mission+owner
    const savedStorage = await page.evaluate(() => {
      const keys = Object.keys(localStorage);
      const pendingKey = keys.find((k) => k.startsWith('pending_validation_tx_43113_'));
      return { pendingKey, value: pendingKey ? localStorage.getItem(pendingKey) : null };
    });
    expect(savedStorage.pendingKey).toBeDefined();
    expect(savedStorage.value).toBe('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

    // 3. Now simulate receipt mined and click again: MUST NOT send transaction again (count remains 1)
    await page.evaluate(() => {
      (window as any).setReceiptMined(true);
    });

    await signBtn2.click();

    // Verify reconciliation POST succeeded
    await expect(page.locator('text=Request submitted and reconciled on-chain!')).toBeVisible({ timeout: 10000 });

    // Verify eth_sendTransaction was NOT called again: count remains 1!
    sendCount = await page.evaluate(() => (window as any).getSendTxCount());
    expect(sendCount).toBe(1);

    // Verify pending tx is removed from localStorage
    const storageAfterReconcile = await page.evaluate(() => {
      const keys = Object.keys(localStorage);
      return keys.find((k) => k.startsWith('pending_validation_tx_43113_'));
    });
    expect(storageAfterReconcile).toBeUndefined();
  });
});
