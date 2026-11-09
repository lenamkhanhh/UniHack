'use client';

import React, { useState, useEffect } from 'react';
import { useI18n } from '@/lib/i18n';
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
  const { t } = useI18n();
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
    setStatus('Khởi tạo đăng ký WebAuthn Passkey (P-256) trên thiết bị...');

    try {
      if (!window.navigator?.credentials) {
        throw new Error('WebAuthn không được hỗ trợ trong môi trường trình duyệt này');
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
        throw new Error('Người dùng đã hủy đăng ký Passkey');
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
      setStatus('Đã đăng ký Passkey thành công! Đã trích xuất tọa độ công khai P-256 (x, y).');
    } catch (err: any) {
      console.warn('Passkey registration error:', err);
      setRegisteredKey(null);
      setErrorMessage(`Đăng ký Passkey thất bại hoặc bị hủy: ${err.message || 'Lỗi không xác định'}`);
      setStatus('');
    } finally {
      setLoading(false);
    }
  }

  async function handleApproveMission() {
    setLoading(true);
    setErrorMessage('');
    setRelayResult(null);
    setStatus('Đang chuẩn bị WebAuthn challenge & yêu cầu xác thực sinh trắc học...');

    try {
      if (!registeredKey || !registeredKey.id) {
        throw new Error('Chưa đăng ký Passkey. Vui lòng bấm Đăng ký Passkey trước khi duyệt mission.');
      }

      // A2-R1: Always fetch fresh on-chain authority configuration before requesting assertion
      const configRes = await fetch('/api/passkey/relay');
      if (!configRes.ok) {
        throw new Error('Không thể kết nối đến Relay API hoặc Passkey Authority chưa được cấu hình.');
      }
      const freshConfig = await configRes.json();
      if (!freshConfig.success || freshConfig.status !== 'CONFIGURED') {
        throw new Error(freshConfig.error || 'Cấu hình Passkey Authority on-chain không khả dụng.');
      }
      setAuthorityConfig(freshConfig);

      // A2-R2: Refuse approval before credentials.get when registered key coordinates differ from fresh on-chain key
      const keyMatches =
        freshConfig.passkeyX !== '0x0' &&
        registeredKey.x.toLowerCase() === freshConfig.passkeyX.toLowerCase() &&
        registeredKey.y.toLowerCase() === freshConfig.passkeyY.toLowerCase();

      if (!keyMatches) {
        throw new Error(
          `Tọa độ Passkey trên thiết bị không khớp với khóa công khai on-chain!\nThiết bị: (${registeredKey.x.slice(0, 10)}..., ${registeredKey.y.slice(0, 10)}...)\nOn-chain: (${freshConfig.passkeyX.slice(0, 10)}..., ${freshConfig.passkeyY.slice(0, 10)}...)\nVui lòng cập nhật khóa hợp đồng hoặc đăng ký đúng passkey.`
        );
      }

      // A2-R2: Validate expected origin against browser context
      const browserOrigin = window.location.origin;
      if (freshConfig.expectedOrigin && freshConfig.expectedOrigin.toLowerCase() !== browserOrigin.toLowerCase()) {
        throw new Error(
          `Origin không khớp! Hợp đồng yêu cầu "${freshConfig.expectedOrigin}" nhưng trình duyệt đang mở tại "${browserOrigin}".`
        );
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
        throw new Error('WebAuthn không khả dụng trên trình duyệt này');
      }

      setStatus('Vui lòng chạm vân tay / Face ID / xác thực Passkey trên thiết bị...');

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
        throw new Error('Người dùng đã hủy hoặc không hoàn tất xác thực Passkey');
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

      setStatus('Đang gửi chữ ký WebAuthn tới Relayer trên Avalanche Fuji...');

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
        throw new Error(data.error || 'Relayer trả về lỗi khi xác thực');
      }

      setRelayResult(data);
      if (data.status === 'CONFIRMED' && data.txHash) {
        setStatus('Mission Đã Duyệt On-Chain Thành Công!');
      } else if (data.status === 'SIMULATION_SUCCESS') {
        setStatus('Mô Phỏng Thực Thi Thành Công (Chưa broadcast on-chain)');
      } else {
        setStatus(`Trạng thái: ${data.status || 'Đã xử lý'}`);
      }
    } catch (err: any) {
      console.error('Passkey approval error:', err);
      setErrorMessage(`Duyệt Mission thất bại: ${err.message || 'Lỗi không xác định'}`);
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
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-6 md:p-12 font-sans">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <div className="border-b border-slate-800 pb-6 space-y-2">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="px-2.5 py-1 text-xs font-semibold uppercase tracking-wider rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
              {t('passkey.tag.w4')}
            </span>
            <span className="px-2.5 py-1 text-xs font-semibold uppercase tracking-wider rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
              {t('passkey.tag.precompile')}
            </span>
            <span className="px-2.5 py-1 text-xs font-semibold uppercase tracking-wider rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
              Chain ID: {authorityConfig.chainId}
            </span>
          </div>
          <h1
            className="text-2xl sm:text-3xl font-bold tracking-tight text-white"
            data-testid="passkey-page-header"
          >
            {t('passkey.hero.title')}
          </h1>
          <p className="text-slate-300 text-xs sm:text-sm mt-1 leading-relaxed">
            {t('passkey.hero.desc')}
          </p>
        </div>

        {/* On-Chain Specs Card */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
            <div className="text-xs text-slate-300 uppercase font-medium">Precompile</div>
            <div className="text-sm font-mono text-emerald-400 mt-1">0x0000...0100</div>
            <div className="text-xs text-slate-400 mt-1">RIP-7212 secp256r1 Native</div>
          </div>
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
            <div className="text-xs text-slate-300 uppercase font-medium">Authority Contract</div>
            <div className="text-sm font-mono text-indigo-400 mt-1" title={authorityConfig.authorityAddress}>
              {authorityConfig.authorityAddress.slice(0, 6)}...{authorityConfig.authorityAddress.slice(-4)}
            </div>
            <div className="text-xs text-slate-400 mt-1">Next Nonce: {authorityConfig.nextNonce}</div>
          </div>
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
            <div className="text-xs text-slate-300 uppercase font-medium">Guarded Treasury</div>
            <div className="text-sm font-mono text-cyan-400 mt-1" title={authorityConfig.treasuryAddress}>
              {authorityConfig.treasuryAddress.slice(0, 6)}...{authorityConfig.treasuryAddress.slice(-4)}
            </div>
            <div className="text-xs text-slate-400 mt-1">Managed Treasury</div>
          </div>
        </div>

        {/* Registered Passkey Status & Metadata */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
              Thiết Bị Passkey Xác Thực (Owner Credential)
            </h2>
            {registeredKey ? (
              <span className="px-2.5 py-0.5 text-xs font-medium rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                Đã ghi nhận Passkey
              </span>
            ) : (
              <span className="px-2.5 py-0.5 text-xs font-medium rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20">
                Chưa đăng ký
              </span>
            )}
          </div>

          {registeredKey ? (
            <div className="space-y-2 text-xs font-mono">
              <div className="text-slate-300 break-all">
                <span className="text-slate-400">Credential ID:</span> {registeredKey.id}
              </div>
              <div className="text-slate-300 break-all">
                <span className="text-slate-400">P-256 X:</span> {registeredKey.x}
              </div>
              <div className="text-slate-300 break-all">
                <span className="text-slate-400">P-256 Y:</span> {registeredKey.y}
              </div>

              <div className="pt-2 flex flex-wrap items-center gap-3">
                {isCoordinatesMatched ? (
                  <span className="px-2 py-1 rounded bg-emerald-950/60 border border-emerald-500/30 text-emerald-300 text-xs">
                    ✓ Khớp hoàn toàn với Passkey đăng ký trên Authority Contract
                  </span>
                ) : (
                  <span className="px-2 py-1 rounded bg-amber-950/60 border border-amber-500/30 text-amber-300 text-xs">
                    ℹ Tọa độ khác Authority on-chain hiện tại (Sử dụng nút xuất cấu hình bên dưới cho script deploy)
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleCopyExport}
                  className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs transition"
                >
                  {copiedExport ? 'Đã sao chép!' : 'Xuất tọa độ cho script deploy'}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-400">
              Nhấn nút &quot;{t('passkey.btn.register')}&quot; để khởi tạo cặp khóa P-256 phần cứng an toàn trên thiết bị (Touch ID, Face ID, Windows Hello). Không có private key nào được lưu trên máy chủ hay truyền qua mạng.
            </p>
          )}
        </div>

        {/* Form Inputs with Explicit Label Bindings */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleApproveMission();
          }}
          className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-6"
        >
          <h2 className="text-lg font-semibold text-white">Mission Configuration & Caps</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="missionSlugInput" className="block text-xs font-semibold text-slate-300 mb-1">
                {t('passkey.field.slug')}
              </label>
              <input
                id="missionSlugInput"
                name="missionSlug"
                type="text"
                value={missionSlug}
                onChange={(e) => setMissionSlug(e.target.value)}
                aria-describedby="missionSlugHelp"
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm font-mono text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 min-h-[44px]"
              />
              <span id="missionSlugHelp" className="sr-only">Unique identifier for this mission</span>
            </div>
            <div>
              <label htmlFor="agentAddressInput" className="block text-xs font-semibold text-slate-300 mb-1">
                {t('passkey.field.agent')}
              </label>
              <input
                id="agentAddressInput"
                name="agentAddress"
                type="text"
                value={agentAddress}
                onChange={(e) => setAgentAddress(e.target.value)}
                aria-describedby="agentAddressHelp"
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm font-mono text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 min-h-[44px]"
              />
              <span id="agentAddressHelp" className="sr-only">Avalanche address of the agent signer</span>
            </div>
          </div>

          <div>
            <label htmlFor="payeeRootInput" className="block text-xs font-semibold text-slate-300 mb-1">
              {t('passkey.field.payee_root')}
            </label>
            <input
              id="payeeRootInput"
              name="payeeRoot"
              type="text"
              value={payeeRoot}
              onChange={(e) => setPayeeRoot(e.target.value)}
              aria-describedby="payeeRootHelp"
              className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm font-mono text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 min-h-[44px]"
            />
            <span id="payeeRootHelp" className="sr-only">Owner-signed Merkle root of authorized payee addresses</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="capUsdcInput" className="block text-xs font-semibold text-slate-300 mb-1">
                {t('passkey.field.cap')}
              </label>
              <input
                id="capUsdcInput"
                name="capUsdc"
                type="text"
                value={capUsdc}
                onChange={(e) => setCapUsdc(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm font-mono text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 min-h-[44px]"
              />
            </div>
            <div>
              <label htmlFor="toolCapUsdcInput" className="block text-xs font-semibold text-slate-300 mb-1">
                {t('passkey.field.tool_cap')}
              </label>
              <input
                id="toolCapUsdcInput"
                name="toolCapUsdc"
                type="text"
                value={toolCapUsdc}
                onChange={(e) => setToolCapUsdc(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm font-mono text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 min-h-[44px]"
              />
            </div>
            <div>
              <label htmlFor="durationHoursInput" className="block text-xs font-semibold text-slate-300 mb-1">
                {t('passkey.field.duration')}
              </label>
              <input
                id="durationHoursInput"
                name="durationHours"
                type="text"
                value={durationHours}
                onChange={(e) => setDurationHours(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm font-mono text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 min-h-[44px]"
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-4 border-t border-slate-800 flex flex-wrap gap-4 items-center">
            <button
              type="button"
              onClick={handleRegisterPasskey}
              disabled={loading}
              className="px-5 py-2.5 rounded-xl font-medium text-sm bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition focus:outline-none focus:ring-2 focus:ring-slate-400 min-h-[44px]"
              data-testid="register-passkey-btn"
            >
              {t('passkey.btn.register')}
            </button>

            <button
              type="submit"
              disabled={loading || !registeredKey}
              className={`px-6 py-2.5 rounded-xl font-semibold text-sm transition flex items-center space-x-2 focus:outline-none min-h-[44px] ${
                !registeredKey || loading
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30 focus:ring-2 focus:ring-indigo-400'
              }`}
              data-testid="approve-passkey-btn"
            >
              <span>{t('passkey.btn.approve')}</span>
            </button>

            {loading && (
              <span className="text-xs text-indigo-300 animate-pulse font-medium">Processing transaction...</span>
            )}
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div
              className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-500/30 text-xs font-mono text-rose-200"
              role="alert"
              data-testid="passkey-error-alert"
            >
              {errorMessage}
            </div>
          )}

          {/* Status Message */}
          {status && (
            <div
              className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200"
              role="status"
              aria-live="polite"
            >
              {status}
            </div>
          )}
        </form>

        {/* Live Relay Results Card */}
        {relayResult && relayResult.status === 'CONFIRMED' && (
          <div
            className="p-6 rounded-2xl bg-emerald-950/20 border border-emerald-500/30 space-y-4"
            data-testid="passkey-confirmed-card"
          >
            <div className="flex items-center space-x-2 text-emerald-300 font-semibold text-sm">
              <span>{t('passkey.success.title')}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
              <div className="break-all">
                <span className="text-slate-300">Tx Hash:</span>{' '}
                <a
                  href={relayResult.snowtraceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-400 underline"
                >
                  {relayResult.txHash || 'N/A'}
                </a>
              </div>
              <div>
                <span className="text-slate-300">Gas Used:</span>{' '}
                <span className="text-emerald-400 font-bold">{relayResult.gasUsed || 'N/A'}</span> (RIP-7212 Native)
              </div>
              <div>
                <span className="text-slate-300">Block Number:</span>{' '}
                <span className="text-white">{relayResult.blockNumber || 'N/A'}</span>
              </div>
              <div>
                <span className="text-slate-300">Security Gate:</span>{' '}
                <span className="text-white">Relayer Gasless · Zero Key on Device</span>
              </div>
            </div>
          </div>
        )}

        {relayResult && relayResult.status === 'SIMULATION_SUCCESS' && (
          <div
            className="p-6 rounded-2xl bg-cyan-950/20 border border-cyan-500/30 space-y-4"
            data-testid="passkey-simulation-card"
          >
            <div className="flex items-center space-x-2 text-cyan-300 font-semibold text-sm">
              <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 text-xs font-bold uppercase">
                Simulation Success
              </span>
              <span>Xác thực mô phỏng thành công (Chưa broadcast on-chain)</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
              <div>
                <span className="text-slate-300">Contract:</span>{' '}
                <span className="text-indigo-300 break-all">{relayResult.authorityAddress}</span>
              </div>
              <div>
                <span className="text-slate-300">Gas Estimated:</span>{' '}
                <span className="text-cyan-400 font-bold">{relayResult.gasEstimated || 'N/A'}</span>
              </div>
              <div className="sm:col-span-2">
                <span className="text-slate-300">Evidence Note:</span>{' '}
                <span className="text-slate-400">{relayResult.message || 'Mô phỏng RPC đã xác minh chữ ký passkey thành công.'}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
