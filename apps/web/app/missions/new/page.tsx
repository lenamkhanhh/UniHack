'use client';

import React, { useState, useEffect } from 'react';
import { useI18n } from '@/lib/i18n';
import { Kicker, Stop } from '@/components/Display';
import {
  extractP256Coordinates,
  parseDerSignature,
  base64UrlToBytes,
  bytesToBase64Url,
  findUtf8ByteIndex,
  slugToMissionId,
  parseDecimalUnits6,
  computeMissionPasskeyChallenge,
} from '@/lib/webauthn-p256';

interface AuthorityConfig {
  authorityAddress: string;
  treasuryAddress: string;
  passkeyX: string;
  passkeyY: string;
  nextNonce: string;
  rpIdHash: string;
  expectedOrigin: string;
  requireUserVerification: boolean;
  chainId: number;
}

interface RegisteredKeyData {
  id: string; // base64url credential id
  x: string;  // 0x + 64 hex
  y: string;  // 0x + 64 hex
  rawPublicKey?: string;
  createdAt: string;
}

const LOCAL_STORAGE_KEY = 'missionpay_registered_passkey';

export default function NewMissionPasskeyPage() {
  const { t, lang } = useI18n();
  const tr = (vi: string, en: string) => (lang === 'vi' ? vi : en);
  const [missionSlug, setMissionSlug] = useState('passkey-mission-live-01');
  const [agentAddress, setAgentAddress] = useState('0x4BC93356C180Ba2Dd13A4a1Cf43405Bd0eb58F7c');
  const [payeeRoot, setPayeeRoot] = useState('0xa7409058b8f2c3bfbb2e9f0b5d56b0d9e8df34906a282f10b74108d8108a8a47');
  const [capUsdc, setCapUsdc] = useState('2.0');
  const [toolCapUsdc, setToolCapUsdc] = useState('0.5');
  const [durationHours, setDurationHours] = useState('24');

  const [authorityConfig, setAuthorityConfig] = useState<AuthorityConfig>({
    authorityAddress: '0x77235386fe59A934645C5F273e411b0Bea8cCc9C',
    treasuryAddress: '0x20451c1e2dCD83F166B4f22868BAdECb5868d545',
    passkeyX: '0x0',
    passkeyY: '0x0',
    nextNonce: '0',
    rpIdHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    expectedOrigin: 'http://localhost:3100',
    requireUserVerification: true,
    chainId: 43113,
  });

  const [registeredKey, setRegisteredKey] = useState<RegisteredKeyData | null>(null);
  const [status, setStatus] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [relayResult, setRelayResult] = useState<any>(null);
  const [copiedExport, setCopiedExport] = useState<boolean>(false);

  // Load authority config from relay API and saved passkey on mount
  useEffect(() => {
    async function loadConfig() {
      try {
        const res = await fetch('/api/passkey/relay');
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            setAuthorityConfig(data);
          }
        }
      } catch {
        // Fall back to default config if offline
      }

      // Check localStorage for previously registered key
      try {
        const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed && parsed.id && parsed.x && parsed.y) {
            setRegisteredKey(parsed);
          }
        }
      } catch {
        // Ignore localStorage errors
      }
    }
    loadConfig();
  }, []);

  async function handleRegisterPasskey() {
    setLoading(true);
    setErrorMessage('');
    setStatus(tr('Khởi tạo đăng ký WebAuthn Passkey (P-256) trên thiết bị...', 'Starting WebAuthn Passkey (P-256) registration on this device...'));

    try {
      if (!window.navigator?.credentials) {
        throw new Error(tr('WebAuthn không được hỗ trợ trong môi trường trình duyệt này', 'WebAuthn is not supported in this browser environment'));
      }

      const challenge = new Uint8Array(32);
      window.crypto.getRandomValues(challenge);
      const userId = new Uint8Array(16);
      window.crypto.getRandomValues(userId);

      const rpId = window.location.hostname || 'localhost';

      const credential = (await window.navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: 'MissionPay Avalanche Authority', id: rpId },
          user: {
            id: userId,
            name: 'owner@missionpay.network',
            displayName: 'MissionPay Vault Owner',
          },
          pubKeyCredParams: [{ alg: -7, type: 'public-key' }], // ES256 (NIST P-256)
          authenticatorSelection: {
            userVerification: 'required',
            residentKey: 'preferred',
          },
          timeout: 60000,
        },
      })) as any;

      if (!credential || !credential.response) {
        throw new Error(tr('Người dùng đã hủy đăng ký Passkey', 'Passkey registration was canceled by the user'));
      }

      // Real P-256 public key extraction from SPKI / attestationObject
      const coords = extractP256Coordinates(credential.response);

      const keyData: RegisteredKeyData = {
        id: credential.id, // base64url string
        x: coords.x,
        y: coords.y,
        rawPublicKey: coords.rawPublicKey,
        createdAt: new Date().toISOString(),
      };

      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(keyData));
      } catch {
        // local storage write optional
      }

      setRegisteredKey(keyData);
      setStatus(tr('Đã đăng ký Passkey thành công! Đã trích xuất tọa độ công khai P-256 (x, y).', 'Passkey registered successfully! Extracted the P-256 public coordinates (x, y).'));
    } catch (err: any) {
      console.warn('Passkey registration error:', err);
      setRegisteredKey(null);
      setErrorMessage(`${tr('Đăng ký Passkey thất bại hoặc bị hủy', 'Passkey registration failed or was canceled')}: ${err.message || tr('Lỗi không xác định', 'Unknown error')}`);
      setStatus('');
    } finally {
      setLoading(false);
    }
  }

  async function handleApproveMission() {
    setLoading(true);
    setErrorMessage('');
    setRelayResult(null);
    setStatus(tr('Đang chuẩn bị WebAuthn challenge & yêu cầu xác thực sinh trắc học...', 'Preparing the WebAuthn challenge and requesting biometric verification...'));

    try {
      if (!registeredKey || !registeredKey.id) {
        throw new Error(tr('Chưa đăng ký Passkey. Vui lòng bấm Đăng ký Passkey trước khi duyệt mission.', 'No Passkey registered. Please register a Passkey before approving the mission.'));
      }

      // A2-R1: Always fetch fresh on-chain authority configuration before requesting assertion
      const configRes = await fetch('/api/passkey/relay');
      if (!configRes.ok) {
        throw new Error(tr('Không thể kết nối đến Relay API hoặc Passkey Authority chưa được cấu hình.', 'Cannot reach the Relay API, or the Passkey Authority is not configured.'));
      }
      const freshConfig = await configRes.json();
      if (!freshConfig.success || freshConfig.status !== 'CONFIGURED') {
        throw new Error(freshConfig.error || tr('Cấu hình Passkey Authority on-chain không khả dụng.', 'On-chain Passkey Authority configuration is unavailable.'));
      }
      setAuthorityConfig(freshConfig);

      // A2-R2: Refuse approval before credentials.get when registered key coordinates differ from fresh on-chain key
      const keyMatches =
        freshConfig.passkeyX !== '0x0' &&
        registeredKey.x.toLowerCase() === freshConfig.passkeyX.toLowerCase() &&
        registeredKey.y.toLowerCase() === freshConfig.passkeyY.toLowerCase();

      if (!keyMatches) {
        throw new Error(
          tr(
            `Tọa độ Passkey trên thiết bị không khớp với khóa công khai on-chain!\nThiết bị: (${registeredKey.x.slice(0, 10)}..., ${registeredKey.y.slice(0, 10)}...)\nOn-chain: (${freshConfig.passkeyX.slice(0, 10)}..., ${freshConfig.passkeyY.slice(0, 10)}...)\nVui lòng cập nhật khóa hợp đồng hoặc đăng ký đúng passkey.`,
            `The device Passkey coordinates do not match the on-chain public key!\nDevice: (${registeredKey.x.slice(0, 10)}..., ${registeredKey.y.slice(0, 10)}...)\nOn-chain: (${freshConfig.passkeyX.slice(0, 10)}..., ${freshConfig.passkeyY.slice(0, 10)}...)\nPlease update the contract key or register the correct passkey.`
          )
        );
      }

      // A2-R2: Validate expected origin against browser context
      const browserOrigin = window.location.origin;
      if (freshConfig.expectedOrigin && freshConfig.expectedOrigin.toLowerCase() !== browserOrigin.toLowerCase()) {
        throw new Error(
          tr(
            `Origin không khớp! Hợp đồng yêu cầu "${freshConfig.expectedOrigin}" nhưng trình duyệt đang mở tại "${browserOrigin}".`,
            `Origin mismatch! The contract expects "${freshConfig.expectedOrigin}" but the browser is open at "${browserOrigin}".`
          )
        );
      }

      // A2-R2: Validate expected RP ID against browser hostname
      if (freshConfig.rpIdHash && freshConfig.rpIdHash !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
        const currentRpId = window.location.hostname || 'localhost';
        const rpIdBuffer = new TextEncoder().encode(currentRpId);
        const rpIdDigest = await window.crypto.subtle.digest('SHA-256', rpIdBuffer);
        const rpIdHashHex = '0x' + Array.from(new Uint8Array(rpIdDigest)).map((b) => b.toString(16).padStart(2, '0')).join('');
        if (rpIdHashHex.toLowerCase() !== freshConfig.rpIdHash.toLowerCase()) {
          throw new Error(
            tr(
              `RP ID không khớp! Hợp đồng yêu cầu rpIdHash "${freshConfig.rpIdHash}" nhưng trình duyệt tạo ra "${rpIdHashHex}" (RP ID: "${currentRpId}").`,
              `RP ID mismatch! The contract expects rpIdHash "${freshConfig.rpIdHash}" but the browser produced "${rpIdHashHex}" (RP ID: "${currentRpId}").`
            )
          );
        }
      }

      const currentNonce = freshConfig.nextNonce;
      const currentAuthority = freshConfig.authorityAddress;
      const currentChainId = freshConfig.chainId;

      // Parse amounts using exact 6-decimal string manipulation (no float rounding)
      const capAtomic = parseDecimalUnits6(capUsdc);
      const toolCapAtomic = parseDecimalUnits6(toolCapUsdc);
      const durationSeconds = BigInt(Math.floor(parseFloat(durationHours) * 3600));
      const nonceBig = BigInt(currentNonce);
      const missionIdBytes32 = slugToMissionId(missionSlug);

      // Compute exact canonical challenge hash matching PasskeyMissionAuthority.sol
      const challengeHash = computeMissionPasskeyChallenge({
        chainId: currentChainId,
        authority: currentAuthority,
        missionId: missionIdBytes32,
        agent: agentAddress,
        payeeRoot: payeeRoot as `0x${string}`,
        cap: capAtomic,
        duration: durationSeconds,
        toolCap: toolCapAtomic,
        nonce: nonceBig,
      });

      // Decode challenge hash (32 bytes) to pass to WebAuthn get
      const challengeRawBytes = new Uint8Array(
        (challengeHash.slice(2).match(/.{1,2}/g) || []).map((b) => parseInt(b, 16))
      );

      // Decode credential id from base64url into raw bytes
      const credentialIdBytes = base64UrlToBytes(registeredKey.id);

      if (!window.navigator?.credentials) {
        throw new Error(tr('WebAuthn không khả dụng trên trình duyệt này', 'WebAuthn is not available in this browser'));
      }

      setStatus(tr('Vui lòng chạm vân tay / Face ID / xác thực Passkey trên thiết bị...', 'Touch your fingerprint / Face ID / verify the Passkey on your device...'));

      const assertion = (await window.navigator.credentials.get({
        publicKey: {
          challenge: challengeRawBytes.buffer as ArrayBuffer,
          allowCredentials: [
            {
              id: credentialIdBytes.buffer as ArrayBuffer,
              type: 'public-key',
            },
          ],
          userVerification: 'required',
          timeout: 60000,
        },
      })) as any;

      if (!assertion || !assertion.response) {
        throw new Error(tr('Người dùng đã hủy hoặc không hoàn tất xác thực Passkey', 'Passkey verification was canceled or not completed'));
      }

      // Real signature parsing and low-s normalization
      const authData = new Uint8Array(assertion.response.authenticatorData);
      const clientDataJSON = new TextDecoder('utf-8').decode(assertion.response.clientDataJSON);
      const sigBytes = new Uint8Array(assertion.response.signature);
      const { rHex, sHex } = parseDerSignature(sigBytes);

      // Multi-byte safe UTF-8 byte index finding
      const typeIndex = findUtf8ByteIndex(clientDataJSON, '"type":"webauthn.get"');
      const challengeIndex = findUtf8ByteIndex(clientDataJSON, '"challenge":"');
      const originIndex = findUtf8ByteIndex(clientDataJSON, '"origin":"');

      let authDataHex = '0x';
      for (let i = 0; i < authData.length; i++) {
        authDataHex += authData[i].toString(16).padStart(2, '0');
      }

      const authPayload = {
        authenticatorData: authDataHex as `0x${string}`,
        clientDataJSON,
        challengeIndex,
        typeIndex,
        originIndex,
        r: rHex,
        s: sHex,
      };

      setStatus(tr('Đang gửi chữ ký WebAuthn tới Relayer trên Avalanche Fuji...', 'Sending the WebAuthn signature to the Relayer on Avalanche Fuji...'));

      const res = await fetch('/api/passkey/relay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          missionId: missionIdBytes32,
          agent: agentAddress,
          payeeRoot,
          cap: capAtomic.toString(),
          duration: durationSeconds.toString(),
          toolCap: toolCapAtomic.toString(),
          nonce: nonceBig.toString(),
          auth: authPayload,
          simulateOnly: false,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || tr('Relayer trả về lỗi khi xác thực', 'The Relayer returned an error during verification'));
      }

      setRelayResult(data);
      if (data.status === 'CONFIRMED' && data.txHash && data.blockNumber) {
        setStatus(tr('Mission Đã Duyệt On-Chain Thành Công!', 'Mission Approved On-Chain Successfully!'));
      } else if (data.status === 'SIMULATION_SUCCESS') {
        setStatus(tr('Mô Phỏng Thực Thi Thành Công (Chưa broadcast on-chain)', 'Simulated Execution Succeeded (Not broadcast on-chain)'));
      } else {
        setStatus(`${tr('Trạng thái', 'Status')}: ${data.status || tr('Đã xử lý', 'Processed')}${data.status === 'CONFIRMED' ? tr(' (Thiếu xác nhận block)', ' (Missing block confirmation)') : ''}`);
      }
    } catch (err: any) {
      console.error('Passkey approval error:', err);
      setErrorMessage(`${tr('Duyệt Mission thất bại', 'Mission approval failed')}: ${err.message || tr('Lỗi không xác định', 'Unknown error')}`);
      setStatus('');
    } finally {
      setLoading(false);
    }
  }

  function handleCopyExport() {
    if (!registeredKey) return;
    const text = `# MissionPay Passkey Authority Deploy Configuration\nPASSKEY_X="${registeredKey.x}"\nPASSKEY_Y="${registeredKey.y}"\nPASSKEY_CREDENTIAL_ID="${registeredKey.id}"`;
    navigator.clipboard?.writeText(text);
    setCopiedExport(true);
    setTimeout(() => setCopiedExport(false), 3000);
  }

  const isCoordinatesMatched =
    registeredKey &&
    authorityConfig.passkeyX !== '0x0' &&
    registeredKey.x.toLowerCase() === authorityConfig.passkeyX.toLowerCase() &&
    registeredKey.y.toLowerCase() === authorityConfig.passkeyY.toLowerCase();

  return (
    <div className="min-h-screen bg-paper text-ink font-sans">
      {/* Hero band: slate */}
      <div className="hero-band hero-slate">
        <section className="hero-inner">
          <Kicker>{t('passkey.tag.w4')}</Kicker>
          <h1
            className="display-h1 mb-5 max-w-[20ch]"
            data-testid="passkey-page-header"
          >
            <Stop>{t('passkey.hero.title')}</Stop>
          </h1>
          <p className="lede">
            {t('passkey.hero.desc')}
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-6">
            <span className="tag-paid border border-paid-rule">
              {t('passkey.tag.precompile')}
            </span>
            <span className="tag-info border border-info-rule font-mono">
              Chain ID: {authorityConfig.chainId}
            </span>
          </div>
        </section>
      </div>

      <div className="wrap band">
      <div className="max-w-4xl space-y-8">

        {/* On-Chain Specs Card */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-4 rounded-data bg-card border border-rule border-t-4 border-t-info">
            <div className="text-sm text-ink-2 font-medium">Precompile</div>
            <div className="font-mono text-[15px] text-paid mt-1">0x0000...0100</div>
            <div className="text-xs text-ink-2 mt-1">RIP-7212 secp256r1 Native</div>
          </div>
          <div className="p-4 rounded-data bg-card border border-rule border-t-4 border-t-info">
            <div className="text-sm text-ink-2 font-medium">Authority Contract</div>
            <div className="font-mono text-[15px] text-info mt-1" title={authorityConfig.authorityAddress}>
              {authorityConfig.authorityAddress.slice(0, 6)}...{authorityConfig.authorityAddress.slice(-4)}
            </div>
            <div className="text-xs text-ink-2 mt-1">Next Nonce: {authorityConfig.nextNonce}</div>
          </div>
          <div className="p-4 rounded-data bg-card border border-rule border-t-4 border-t-info">
            <div className="text-sm text-ink-2 font-medium">Guarded Treasury</div>
            <div className="font-mono text-[15px] text-info mt-1" title={authorityConfig.treasuryAddress}>
              {authorityConfig.treasuryAddress.slice(0, 6)}...{authorityConfig.treasuryAddress.slice(-4)}
            </div>
            <div className="text-xs text-ink-2 mt-1">Managed Treasury</div>
          </div>
        </div>

        {/* Registered Passkey Status & Metadata */}
        <div className="p-5 rounded-card bg-card border border-rule space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="card-title">
              {tr('Thiết Bị Passkey Xác Thực (Owner Credential)', 'Authenticator Passkey Device (Owner Credential)')}
            </h2>
            {registeredKey ? (
              <span className="tag-paid border border-paid-rule">
                {tr('Đã ghi nhận Passkey', 'Passkey recorded')}
              </span>
            ) : (
              <span className="tag-warn border border-warn-rule">
                {tr('Chưa đăng ký', 'Not registered')}
              </span>
            )}
          </div>

          {registeredKey ? (
            <div className="space-y-2 text-sm font-mono">
              <div className="text-ink-2 break-all">
                <span className="text-ink-2">Credential ID:</span> {registeredKey.id}
              </div>
              <div className="text-ink-2 break-all">
                <span className="text-ink-2">P-256 X:</span> {registeredKey.x}
              </div>
              <div className="text-ink-2 break-all">
                <span className="text-ink-2">P-256 Y:</span> {registeredKey.y}
              </div>

              <div className="pt-2 flex flex-wrap items-center gap-3">
                {isCoordinatesMatched ? (
                  <span className="px-2 py-1 rounded-tag bg-paid-bg border border-paid-rule text-paid text-xs">
                    {tr('✓ Khớp hoàn toàn với Passkey đăng ký trên Authority Contract', '✓ Fully matches the Passkey registered on the Authority Contract')}
                  </span>
                ) : (
                  <span className="px-2 py-1 rounded-tag bg-warn-bg border border-warn-rule text-warn text-xs">
                    {tr('ℹ Tọa độ khác Authority on-chain hiện tại (Sử dụng nút xuất cấu hình bên dưới cho script deploy)', 'ℹ Coordinates differ from the current on-chain Authority (use the export button below for the deploy script)')}
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleCopyExport}
                  className="btn-ghost btn-sm"
                >
                  {copiedExport ? tr('Đã sao chép!', 'Copied!') : tr('Xuất tọa độ cho script deploy', 'Export coordinates for the deploy script')}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-[15px] text-ink-2">
              {lang === 'vi' ? (
                <>Nhấn nút &quot;{t('passkey.btn.register')}&quot; để khởi tạo cặp khóa P-256 phần cứng an toàn trên thiết bị (Touch ID, Face ID, Windows Hello). Không có private key nào được lưu trên máy chủ hay truyền qua mạng.</>
              ) : (
                <>Press &quot;{t('passkey.btn.register')}&quot; to create a hardware-backed P-256 key pair on this device (Touch ID, Face ID, Windows Hello). No private key is stored on the server or sent over the network.</>
              )}
            </p>
          )}
        </div>

        {/* Form Inputs with Explicit Label Bindings */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleApproveMission();
          }}
          className="p-6 rounded-card bg-card border border-rule space-y-6"
        >
          <h2 className="card-title">Mission Configuration & Caps</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="missionSlugInput" className="block text-[15px] font-semibold text-ink mb-1.5">
                {t('passkey.field.slug')}
              </label>
              <input
                id="missionSlugInput"
                name="missionSlug"
                type="text"
                value={missionSlug}
                onChange={(e) => setMissionSlug(e.target.value)}
                aria-describedby="missionSlugHelp"
                className="input w-full font-mono text-sm min-h-[44px]"
              />
              <span id="missionSlugHelp" className="sr-only">Unique identifier for this mission</span>
            </div>
            <div>
              <label htmlFor="agentAddressInput" className="block text-[15px] font-semibold text-ink mb-1.5">
                {t('passkey.field.agent')}
              </label>
              <input
                id="agentAddressInput"
                name="agentAddress"
                type="text"
                value={agentAddress}
                onChange={(e) => setAgentAddress(e.target.value)}
                aria-describedby="agentAddressHelp"
                className="input w-full font-mono text-sm min-h-[44px]"
              />
              <span id="agentAddressHelp" className="sr-only">Avalanche address of the agent signer</span>
            </div>
          </div>

          <div>
            <label htmlFor="payeeRootInput" className="block text-[15px] font-semibold text-ink mb-1.5">
              {t('passkey.field.payee_root')}
            </label>
            <input
              id="payeeRootInput"
              name="payeeRoot"
              type="text"
              value={payeeRoot}
              onChange={(e) => setPayeeRoot(e.target.value)}
              aria-describedby="payeeRootHelp"
              className="input w-full font-mono text-sm min-h-[44px]"
            />
            <span id="payeeRootHelp" className="sr-only">Owner-signed Merkle root of authorized payee addresses</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="capUsdcInput" className="block text-[15px] font-semibold text-ink mb-1.5">
                {t('passkey.field.cap')}
              </label>
              <input
                id="capUsdcInput"
                name="capUsdc"
                type="text"
                value={capUsdc}
                onChange={(e) => setCapUsdc(e.target.value)}
                className="input w-full font-mono text-sm min-h-[44px]"
              />
            </div>
            <div>
              <label htmlFor="toolCapUsdcInput" className="block text-[15px] font-semibold text-ink mb-1.5">
                {t('passkey.field.tool_cap')}
              </label>
              <input
                id="toolCapUsdcInput"
                name="toolCapUsdc"
                type="text"
                value={toolCapUsdc}
                onChange={(e) => setToolCapUsdc(e.target.value)}
                className="input w-full font-mono text-sm min-h-[44px]"
              />
            </div>
            <div>
              <label htmlFor="durationHoursInput" className="block text-[15px] font-semibold text-ink mb-1.5">
                {t('passkey.field.duration')}
              </label>
              <input
                id="durationHoursInput"
                name="durationHours"
                type="text"
                value={durationHours}
                onChange={(e) => setDurationHours(e.target.value)}
                className="input w-full font-mono text-sm min-h-[44px]"
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-4 border-t border-rule flex flex-wrap gap-4 items-center">
            <button
              type="button"
              onClick={handleRegisterPasskey}
              disabled={loading}
              className="btn-ghost min-h-[44px] focus:outline-none focus:ring-2 focus:ring-ink"
              data-testid="register-passkey-btn"
            >
              {t('passkey.btn.register')}
            </button>

            <button
              type="submit"
              disabled={loading || !registeredKey}
              className={`btn min-h-[44px] focus:outline-none ${
                !registeredKey || loading
                  ? 'bg-mist text-ink-3 cursor-not-allowed border border-rule'
                  : 'bg-brand hover:bg-brand-deep text-white focus:ring-2 focus:ring-ink'
              }`}
              data-testid="approve-passkey-btn"
            >
              <span>{t('passkey.btn.approve')}</span>
            </button>

            {loading && (
              <span className="text-sm text-ink animate-pulse font-medium">Processing transaction...</span>
            )}
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div
              className="outcome-blocked p-3.5 text-sm text-blocked"
              role="alert"
              data-testid="passkey-error-alert"
            >
              {errorMessage}
            </div>
          )}

          {/* Status Message */}
          {status && (
            <div
              className="p-3.5 rounded-data bg-paper border border-rule text-sm text-ink"
              role="status"
              aria-live="polite"
            >
              {status}
            </div>
          )}
        </form>

        {/* Live Relay Results Card */}
        {relayResult && relayResult.status === 'CONFIRMED' && relayResult.txHash && relayResult.blockNumber && (
          <div
            className="outcome-paid p-6 space-y-4"
            data-testid="passkey-confirmed-card"
          >
            <div className="flex items-center space-x-2 text-paid font-semibold text-lg">
              <span>{t('passkey.success.title')}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div className="break-all">
                <span className="text-ink-2">Tx Hash:</span>{' '}
                <a
                  href={relayResult.snowtraceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="link font-mono"
                >
                  {relayResult.txHash || 'N/A'}
                </a>
              </div>
              <div>
                <span className="text-ink-2">Gas Used:</span>{' '}
                <span className="text-paid font-bold">{relayResult.gasUsed || 'N/A'}</span> (RIP-7212 Native)
              </div>
              <div>
                <span className="text-ink-2">Block Number:</span>{' '}
                <span className="text-ink">{relayResult.blockNumber || 'N/A'}</span>
              </div>
              <div>
                <span className="text-ink-2">Security Gate:</span>{' '}
                <span className="text-ink">Relayer Gasless · Zero Key on Device</span>
              </div>
            </div>
          </div>
        )}

        {relayResult && relayResult.status === 'SIMULATION_SUCCESS' && (
          <div
            className="p-6 rounded-data bg-info-bg border border-info-rule border-l-4 border-l-info space-y-4"
            data-testid="passkey-simulation-card"
          >
            <div className="flex items-center space-x-2 text-ink font-semibold text-sm">
              <span className="tag-info border border-info-rule">
                Simulation Success
              </span>
              <span>{tr('Xác thực mô phỏng thành công (Chưa broadcast on-chain)', 'Simulated verification succeeded (Not broadcast on-chain)')}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-ink-2">Contract:</span>{' '}
                <span className="text-ink break-all">{relayResult.authorityAddress}</span>
              </div>
              <div>
                <span className="text-ink-2">Gas Estimated:</span>{' '}
                <span className="text-ink font-bold">{relayResult.gasEstimated || 'N/A'}</span>
              </div>
              <div className="sm:col-span-2">
                <span className="text-ink-2">Evidence Note:</span>{' '}
                <span className="text-ink-2">{relayResult.message || tr('Mô phỏng RPC đã xác minh chữ ký passkey thành công.', 'The RPC simulation verified the passkey signature successfully.')}</span>
              </div>
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
