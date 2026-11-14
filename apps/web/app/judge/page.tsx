'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';

interface JudgeReceiptItem {
  id: string;
  step: number;
  label: string;
  labelVi: string;
  description: string;
  descriptionVi: string;
  txHash: string;
  status: 'success' | 'reverted';
  revertReason?: string;
  blockNumber: number;
  gasUsed: string;
  outflow: string;
  outflowVi: string;
  snowtraceUrl: string;
}

interface SimulateResult {
  success: boolean;
  outcome: 'SUCCESS' | 'REVERT';
  recipient: string;
  amountAtomic: number;
  amountUsdc: string;
  revertReason?: string;
  missionBExpiry: string | null;
  message: string;
}

const OWNER_ADDRESS = '0x4BC93356C180Ba2Dd13A4a1Cf43405Bd0eb58F7c';
const AGENT_ADDRESS = '0x374b8A126FDb9e5deEc8307da385076155Af3D72';
const TREASURY_ADDRESS = '0x20451c1e2dCD83F166B4f22868BAdECb5868d545';
const MISSION_B_ID = '0x7477696e2e6d697373696f6e2e76310000000000000000000000000000000000';

function makeRandomAddress(): string {
  const hexChars = '0123456789abcdef';
  let addr = '0x';
  for (let i = 0; i < 40; i++) {
    addr += hexChars[Math.floor(Math.random() * 16)];
  }
  return addr;
}

export default function JudgePage() {
  const { lang } = useI18n();
  const isVi = lang === 'vi';

  // Block 1 state: live receipts from Fuji
  const [receipts, setReceipts] = useState<JudgeReceiptItem[]>([]);
  const [loadingReceipts, setLoadingReceipts] = useState<boolean>(true);
  const [receiptsError, setReceiptsError] = useState<string | null>(null);

  // Block 2 state: interactive simulation
  const [recipient, setRecipient] = useState<string>('');
  const [amountAtomic, setAmountAtomic] = useState<number>(10000); // 0.01 USDC
  const [simulating, setSimulating] = useState<boolean>(false);
  const [simResult, setSimResult] = useState<SimulateResult | null>(null);
  const [simError, setSimError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Initialize random address on client
  useEffect(() => {
    setRecipient(makeRandomAddress());
  }, []);

  // Fetch receipts on mount
  useEffect(() => {
    setLoadingReceipts(true);
    fetch('/api/judge/receipts')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to read live receipts`);
        return res.json();
      })
      .then((data) => {
        if (data.success && data.receipts) {
          setReceipts(data.receipts);
        } else {
          setReceiptsError(data.message || 'Unable to retrieve receipts');
        }
        setLoadingReceipts(false);
      })
      .catch((err) => {
        setReceiptsError(err.message || 'RPC communication error');
        setLoadingReceipts(false);
      });
  }, []);

  const handleSimulate = async (customTo?: string) => {
    const targetAddress = customTo || recipient;
    if (!targetAddress) return;

    setSimulating(true);
    setSimError(null);
    setSimResult(null);

    try {
      const res = await fetch('/api/judge/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: targetAddress,
          amountAtomic: Number(amountAtomic),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || `Error ${res.status}`);
      }

      const sim = data.simulation || data;
      setSimResult({
        ...sim,
        outcome: sim.outcome,
        message: isVi ? (sim.detailsVi || sim.details || sim.message) : (sim.details || sim.message || ''),
        amountUsdc: sim.amountUsdc || `${(Number(sim.amountAtomic) / 1_000_000).toFixed(6)} USDC`,
      });
    } catch (err: any) {
      setSimError(err.message || 'Simulation error');
    } finally {
      setSimulating(false);
    }
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  const castAttackerCmd = `cast call ${TREASURY_ADDRESS} "proposeWithProof(bytes32,address,uint256,bytes32,string,bytes32[])" 0x0000000000000000000000000000000000000000000000000000000000000001 0xDead000000000000000000000000000000000001 10000 ${MISSION_B_ID} "attacker test" "[]" --from ${AGENT_ADDRESS} --rpc-url https://api.avax-test.network/ext/bc/C/rpc`;

  const castOwnerCmd = `cast call ${TREASURY_ADDRESS} "proposeWithProof(bytes32,address,uint256,bytes32,string,bytes32[])" 0x0000000000000000000000000000000000000000000000000000000000000002 ${OWNER_ADDRESS} 10000 ${MISSION_B_ID} "owner control" "[]" --from ${AGENT_ADDRESS} --rpc-url https://api.avax-test.network/ext/bc/C/rpc`;

  return (
    <div>
      {/* Hero band: sand */}
      <div className="bg-sand border-b border-rule">
      <section className="space-y-4 pt-10 pb-10 max-w-6xl mx-auto px-4 sm:px-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-[5px] bg-card border border-rule-2 text-ink text-xs font-semibold">
          <span className="flex h-2 w-2 relative">
            <span className="text-white absolute inline-flex h-full w-full rounded-full bg-ink opacity-75"></span>
            <span className="text-white relative inline-flex rounded-full h-2 w-2 bg-ink"></span>
          </span>
          {isVi
            ? 'XÁC MINH TRỰC TIẾP AVALANCHE FUJI · ĐÁNH GIÁ 30 GIÂY'
            : 'AVALANCHE FUJI LIVE VERIFICATION · 30-SECOND AUDIT'}
        </div>

        <h1 className="text-[34px] sm:text-[46px] font-bold text-ink leading-[1.05] tracking-[-0.04em] max-w-[22ch]">
          {isVi
            ? 'Chế độ Giám khảo: Tự Kiểm Chứng trong 30 Giây'
            : 'Judge Mode: Verify On-Chain Proof in 30 Seconds'}
        </h1>

        <p className="text-ink-2 text-base md:text-[17.5px] max-w-3xl leading-relaxed">
          {isVi
            ? 'Kiểm tra biên lai các giao dịch đã thực sự diễn ra on-chain trên Avalanche Fuji C-Chain, hoặc trực tiếp mô phỏng các giao dịch tấn công từ ví agent tới smart contract bằng eth_call ngay tại đây.'
            : 'Inspect live receipts of transactions that already occurred on Avalanche Fuji C-Chain, or simulate arbitrary off-mission attacks directly against the deployed contract via eth_call with zero gas and zero setup.'}
        </p>
      </section>
      </div>

      <div className="space-y-12 py-10 max-w-6xl mx-auto px-4 sm:px-6">
      {/* Block 1: Already happened on Fuji */}
      <section aria-labelledby="block1-heading" className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 id="block1-heading" className="text-xl sm:text-2xl font-bold text-ink flex items-center gap-2">
              <span>{isVi ? 'Đã Diễn Ra Trên Avalanche Fuji C-Chain' : 'Already Happened on Avalanche Fuji C-Chain'}</span>
            </h2>
            <p className="text-xs sm:text-sm text-ink-2 mt-1">
              {isVi
                ? 'Đọc trực tiếp từ RPC Avalanche Fuji thông qua viem getTransactionReceipt khi tải trang. Không có số liệu gõ tay.'
                : 'Queried directly from Avalanche Fuji RPC on page load via viem getTransactionReceipt. 100% measured on-chain.'}
            </p>
          </div>
          <Link
            href="/arena/twin"
            className="text-xs text-ink hover:text-ink underline flex items-center gap-1"
          >
            <span>{isVi ? 'Xem Bảng Đối Chứng Twin Treasury' : 'View Twin Treasury Arena'}</span>
            <span>→</span>
          </Link>
        </div>

        {loadingReceipts ? (
          <div className="p-8 rounded-card bg-card border border-rule text-center space-y-3">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-paid"></div>
            <p className="text-sm text-ink-2">
              {isVi ? 'Đang đọc biên lai trực tiếp từ Avalanche Fuji RPC...' : 'Fetching live transaction receipts from Avalanche Fuji RPC...'}
            </p>
          </div>
        ) : receiptsError ? (
          <div className="p-6 rounded-card bg-blocked-bg border border-blocked-rule text-blocked space-y-2">
            <div className="font-bold flex items-center gap-2">
              <span>{isVi ? 'Lỗi kết nối RPC Fuji' : 'Fuji RPC Connectivity Issue'}</span>
            </div>
            <p className="text-xs text-blocked">{receiptsError}</p>
          </div>
        ) : (
          <div id="judge-receipts-grid" className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {receipts.map((rc) => {
              const isSuccess = rc.status === 'success';
              return (
                <div
                  key={rc.id}
                  id={`receipt-card-${rc.id}`}
                  className={`p-5 rounded-card border border-l-4 transition-all flex flex-col justify-between space-y-4 ${
                    isSuccess
                      ? 'bg-paid-bg border-paid-rule border-l-paid'
                      : 'bg-blocked-bg border-blocked-rule border-l-brand'
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-ink-2">
                        STEP {rc.step}
                      </span>
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider ${
                          isSuccess
                            ? 'bg-paid-bg text-paid border border-paid-rule'
                            : 'bg-blocked-bg text-blocked border border-blocked-rule'
                        }`}
                      >
                        {isSuccess
                          ? isVi
                            ? '✓ THÀNH CÔNG'
                            : '✓ SUCCESS'
                          : isVi
                          ? '✗ REVERTED (BỊ CHẶN)'
                          : '✗ REVERTED (BLOCKED)'}
                      </span>
                    </div>

                    <h3 className="font-bold text-sm text-ink leading-snug">
                      {isVi ? rc.labelVi : rc.label}
                    </h3>

                    <p className="text-xs text-ink-2 leading-relaxed">
                      {isVi ? rc.descriptionVi : rc.description}
                    </p>

                    <div className="p-2.5 rounded-xl bg-paper border border-rule space-y-1 text-[11px]">
                      <div className="flex justify-between text-ink-2">
                        <span>Block:</span>
                        <span className="text-ink font-semibold">#{rc.blockNumber}</span>
                      </div>
                      <div className="flex justify-between text-ink-2">
                        <span>Gas Used:</span>
                        <span className="text-ink">{Number(rc.gasUsed).toLocaleString()} gas</span>
                      </div>
                      <div className="flex justify-between text-ink-2">
                        <span>Outflow:</span>
                        <span className={isSuccess ? 'text-paid font-bold' : 'text-warn font-bold'}>
                          {isVi ? rc.outflowVi : rc.outflow}
                        </span>
                      </div>
                      {rc.revertReason && (
                        <div className="flex justify-between text-ink-2 pt-1 border-t border-rule">
                          <span>Revert:</span>
                          <span className="font-mono text-blocked font-bold">{rc.revertReason}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <a
                    href={rc.snowtraceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 w-full py-2 px-3 rounded-xl bg-paper hover:bg-mist border border-rule hover:border-rule text-xs text-ink transition focus:outline-none focus:ring-2 focus:ring-ink"
                  >
                    <span>{isVi ? 'Xem trên Snowtrace' : 'View on Snowtrace'}</span>
                    <span>↗</span>
                  </a>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Block 2: Try it yourself */}
      <section aria-labelledby="block2-heading" className="p-6 sm:p-8 rounded-card bg-card border border-rule space-y-6">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-[5px] bg-warn-bg border border-warn-rule text-warn text-xs font-semibold mb-2">
            <span>{isVi ? 'TƯƠNG TÁC TRỰC TIẾP · KHÔNG CẦN GAS' : 'INTERACTIVE AUDIT · ZERO GAS'}</span>
          </div>
          <h2 id="block2-heading" className="text-xl sm:text-2xl font-bold text-ink flex items-center gap-2">
            <span>{isVi ? 'Tự Mình Kiểm Chứng (Mô Phỏng Trực Tiếp Trên Fuji)' : 'Try It Yourself: Interactive Fuji Contract Simulation'}</span>
          </h2>
          <p className="text-xs sm:text-sm text-ink-2 mt-1 max-w-3xl">
            {isVi
              ? 'Nhập bất kỳ địa chỉ ví nào để thử nghiệm giải ngân dưới Mission B (đã áp Merkle root do chủ sở hữu ký). Máy chủ sẽ gửi eth_call với tư cách ví agent tới smart contract GuardedTreasury trên Avalanche Fuji C-Chain.'
              : 'Enter ANY recipient address to test against Mission B (enforcing owner-signed Merkle payee root). The server executes an eth_call with account=agent against the live Fuji GuardedTreasury contract.'}
          </p>
          <div className="mt-2 text-xs text-paid">
            {isVi
              ? 'Mô phỏng eth_call đối với hợp đồng thực tế; không phát sóng giao dịch, không tiêu tốn tiền.'
              : 'eth_call simulation against the live contract; nothing is sent, zero gas consumed.'}
          </div>
        </div>

        {/* Input & Action Form */}
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block text-xs font-bold text-ink-2 uppercase">
              {isVi ? 'Địa chỉ người nhận đề xuất (Recipient Address):' : 'Proposed Payee Address:'}
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value.trim())}
                placeholder="0x..."
                className="flex-1 min-w-0 px-4 py-2.5 rounded-full bg-card border border-rule-2-2 font-mono text-sm text-ink focus:outline-none focus:ring-2 focus:ring-ink"
              />
              <button
                type="button"
                onClick={() => setRecipient(makeRandomAddress())}
                className="px-4 py-2.5 rounded-full bg-card hover:bg-mist text-sm font-semibold text-ink border border-rule-2 transition"
              >
                {isVi ? 'Ví Kẻ Tấn Công Ngẫu Nhiên' : 'Random Attacker'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setRecipient(OWNER_ADDRESS);
                  handleSimulate(OWNER_ADDRESS);
                }}
                className="px-4 py-2.5 rounded-full bg-paid-bg hover:bg-[#D3EBDD] border border-paid-rule text-sm text-paid font-semibold transition"
              >
                {isVi ? 'Thử Ví Owner (Đối Chứng Dương)' : 'Test Owner (Positive Control)'}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div className="w-full sm:w-auto">
              <label className="block text-xs text-ink-2 mb-1">
                {isVi ? 'Số tiền mô phỏng (atomic units, max 10000 = 0.01 USDC):' : 'Amount (atomic units, max 10000 = 0.01 USDC):'}
              </label>
              <input
                type="number"
                min="1"
                max="10000"
                value={amountAtomic}
                onChange={(e) => setAmountAtomic(Number(e.target.value))}
                className="w-48 px-3 py-2 rounded-xl bg-card border border-rule-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-ink"
              />
            </div>

            <div className="pt-5">
              <button
                type="button"
                disabled={simulating || !recipient}
                onClick={() => handleSimulate()}
                className="bg-brand hover:bg-brand-deep text-white px-6 py-2.5 rounded-full font-semibold text-sm disabled:opacity-50 transition focus:outline-none focus:ring-2 focus:ring-ink flex items-center gap-2"
              >
                {simulating ? (
                  <>
                    <span className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-rule"></span>
                    <span>{isVi ? 'Đang hỏi hợp đồng Fuji...' : 'Querying Fuji Contract...'}</span>
                  </>
                ) : (
                  <>
                    <span>{isVi ? 'Hỏi Hợp Đồng Fuji Ngay' : 'Ask the Fuji Contract'}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Simulation Output Card */}
        {simError && (
          <div className="p-4 rounded-xl bg-blocked-bg border border-blocked-rule text-blocked text-xs space-y-1">
            <div className="font-bold flex items-center gap-2">
              <span>{isVi ? 'Lỗi mô phỏng:' : 'Simulation Error:'}</span>
            </div>
            <div>{simError}</div>
          </div>
        )}

        {simResult && (
          <div
            id="simulation-result-card"
            data-outcome={simResult.outcome}
            className={`p-5 rounded-card border border-l-4 transition-all space-y-3 ${
              simResult.outcome === 'REVERT'
                ? 'bg-blocked-bg border-blocked-rule border-l-brand'
                : 'bg-paid-bg border-paid-rule border-l-paid'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule pb-2">
              <div className="flex items-center gap-2">
                <span className="text-base">{simResult.outcome === 'REVERT' ? '🛑' : '✅'}</span>
                <span className="font-bold text-sm text-ink">
                  {simResult.outcome === 'REVERT'
                    ? isVi
                      ? 'HỢP ĐỒNG FUJI TỪ CHỐI (REVERT)'
                      : 'CONTRACT REVERTED (BLOCKED)'
                    : isVi
                    ? 'HỢP ĐỒNG FUJI CHẤP NHẬN (SUCCESS)'
                    : 'CONTRACT ACCEPTED (PAYOUT AUTHORIZED)'}
                </span>
              </div>
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                  simResult.outcome === 'REVERT'
                    ? 'bg-blocked-bg text-blocked border border-blocked-rule'
                    : 'bg-paid-bg text-paid border border-paid-rule'
                }`}
              >
                {simResult.outcome}
              </span>
            </div>

            <p className="text-sm text-ink">{simResult.message}</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-1">
              <div className="p-2.5 rounded-lg bg-paper border border-rule space-y-1">
                <div className="text-ink-2">Tested Payee:</div>
                <div className="font-mono text-ink truncate">{simResult.recipient}</div>
              </div>
              <div className="p-2.5 rounded-lg bg-paper border border-rule space-y-1">
                <div className="text-ink-2">Simulated Amount:</div>
                <div className="text-ink">
                  {simResult.amountAtomic} atomic units ({simResult.amountUsdc})
                </div>
              </div>
              {simResult.revertReason && (
                <div className="p-2.5 rounded-lg bg-paper border border-rule space-y-1 sm:col-span-2">
                  <div className="text-ink-2">Exact On-Chain Revert Reason:</div>
                  <div className="font-mono text-blocked font-bold text-sm">{simResult.revertReason}</div>
                </div>
              )}
              <div className="p-2.5 rounded-lg bg-paper border border-rule space-y-1 sm:col-span-2">
                <div className="text-ink-2">
                  {isVi ? 'Thời hạn hiệu lực Mission B (đọc từ contract):' : 'Mission B Expiry (read on-chain):'}
                </div>
                <div className="text-ink">
                  {simResult.missionBExpiry
                    ? `${new Date(simResult.missionBExpiry).toLocaleString()} (Valid through Demo Day Nov 30)`
                    : isVi
                    ? 'Không thể xác định (RPC read unavailable)'
                    : 'Unknown (RPC read unavailable)'}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Block 3: Reproduce from a terminal */}
      <section aria-labelledby="block3-heading" className="space-y-4">
        <div>
          <h2 id="block3-heading" className="text-xl sm:text-2xl font-bold text-ink flex items-center gap-2">
            <span>{isVi ? 'Tái Lập Độc Lập Từ Terminal Của Bạn (Foundry Cast)' : 'Reproduce from Your Terminal (Foundry Cast)'}</span>
          </h2>
          <p className="text-xs sm:text-sm text-ink-2 mt-1">
            {isVi
              ? 'Không tin giao diện web? Copy các câu lệnh cast call dưới đây và dán thẳng vào terminal cá nhân. RPC công khai không cần cấu hình key.'
              : "Don't trust the web UI? Copy-paste these read-only cast call commands directly into your local terminal against public Fuji RPC."}
          </p>
        </div>

        <div className="space-y-4">
          {/* Attacker Revert Command */}
          <div className="p-4 sm:p-5 rounded-card bg-card border border-rule space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-blocked">
                {isVi ? 'A. Kịch bản kẻ tấn công (Kỳ vọng: revert PayeeNotInMissionSet)' : 'A. Attacker Scenario (Expected Revert: PayeeNotInMissionSet)'}
              </span>
              <button
                type="button"
                onClick={() => copyToClipboard(castAttackerCmd, 'attacker')}
                className="px-3 py-1 rounded-full bg-mist hover:bg-mist-2 text-xs text-ink transition"
              >
                {copiedKey === 'attacker' ? (isVi ? 'Đã sao chép! ✓' : 'Copied! ✓') : isVi ? 'Sao chép lệnh' : 'Copy command'}
              </button>
            </div>
            <pre className="font-mono p-3 rounded-xl bg-paper border border-rule text-[11px] text-ink-2 overflow-x-auto whitespace-pre-wrap break-all">
              {castAttackerCmd}
            </pre>
          </div>

          {/* Owner Positive Control Command */}
          <div className="p-4 sm:p-5 rounded-card bg-card border border-rule space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-paid">
                {isVi ? 'B. Kịch bản đối chứng hợp lệ (Kỳ vọng: proposal ID thành công)' : 'B. Positive Control Scenario (Expected: Proposal ID Success)'}
              </span>
              <button
                type="button"
                onClick={() => copyToClipboard(castOwnerCmd, 'owner')}
                className="px-3 py-1 rounded-full bg-mist hover:bg-mist-2 text-xs text-ink transition"
              >
                {copiedKey === 'owner' ? (isVi ? 'Đã sao chép! ✓' : 'Copied! ✓') : isVi ? 'Sao chép lệnh' : 'Copy command'}
              </button>
            </div>
            <pre className="font-mono p-3 rounded-xl bg-paper border border-rule text-[11px] text-ink-2 overflow-x-auto whitespace-pre-wrap break-all">
              {castOwnerCmd}
            </pre>
          </div>
        </div>
      </section>

      {/* Block 4: Resources & Known Limits */}
      <section aria-labelledby="block4-heading" className="p-6 sm:p-8 rounded-card bg-card border border-rule space-y-6">
        <h2 id="block4-heading" className="text-xl sm:text-2xl font-bold text-ink flex items-center gap-2">
          <span>{isVi ? 'Tài Liệu Kiểm Chứng & Giới Hạn Đã Biết' : 'Resources & Known Limits'}</span>
        </h2>

        {/* 3 Links */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <a
            href="https://github.com/lenamkhanhh/UniHack/raw/feat/s1-app/artifacts/submission-s1/deck-v2/MissionPay_Deck_v2.pdf"
            target="_blank"
            rel="noreferrer"
            className="p-4 rounded-card bg-paper hover:bg-mist border border-rule hover:border-rule transition space-y-1 block"
          >
            <div className="font-bold text-sm text-ink flex items-center justify-between">
              <span>{isVi ? 'Slide Thuyết Trình (PDF)' : 'Pitch Deck (PDF)'}</span>
              <span className="text-xs text-ink-2">↗</span>
            </div>
            <p className="text-xs text-ink-2">
              {isVi ? '13 slide định dạng PDF với số liệu benchmark thật.' : '13-slide pitch deck with verified replay benchmark.'}
            </p>
          </a>

          <a
            href="https://github.com/lenamkhanhh/UniHack/blob/feat/s1-app/artifacts/submission-s1/FUJI_EVIDENCE.md"
            target="_blank"
            rel="noreferrer"
            className="p-4 rounded-card bg-paper hover:bg-mist border border-rule hover:border-rule transition space-y-1 block"
          >
            <div className="font-bold text-sm text-ink flex items-center justify-between">
              <span>{isVi ? 'Bằng Chứng Fuji On-Chain' : 'Fuji On-Chain Evidence'}</span>
              <span className="text-xs text-ink-2">↗</span>
            </div>
            <p className="text-xs text-ink-2">
              {isVi ? 'Danh sách tx hash, contract address và log sự kiện.' : 'Complete tx hashes, deployed contract addresses, and event logs.'}
            </p>
          </a>

          <a
            href="https://github.com/lenamkhanhh/UniHack"
            target="_blank"
            rel="noreferrer"
            className="p-4 rounded-card bg-paper hover:bg-mist border border-rule hover:border-rule transition space-y-1 block"
          >
            <div className="font-bold text-sm text-ink flex items-center justify-between">
              <span>{isVi ? 'Mã Nguồn GitHub' : 'GitHub Repository'}</span>
              <span className="text-xs text-ink-2">↗</span>
            </div>
            <p className="text-xs text-ink-2">
              {isVi ? 'Kho mã nguồn đầy đủ kèm bộ test Foundry và Vitest.' : 'Full source code with Foundry unit and invariant suites.'}
            </p>
          </a>
        </div>

        {/* Known Limits Disclosure */}
        <div className="p-5 rounded-card bg-paper border border-warn-rule space-y-3">
          <div className="font-bold text-xs uppercase tracking-wider text-warn flex items-center gap-2">
            <span>{isVi ? 'Tính Minh Bạch: Các Giới Hạn Đã Biết (Known Limits)' : 'Honest Disclosure: Known Limits'}</span>
          </div>
          <ul className="text-xs text-ink-2 space-y-2 list-disc pl-4 leading-relaxed">
            <li>
              <strong className="text-ink">Deployed Fuji Bytecode:</strong>{' '}
              {isVi
                ? 'Hợp đồng triển khai trên Fuji (0x2045...d545) sử dụng bytecode ban đầu, chưa có bản vá A1 (snapshot Merkle root) và A3 (quản trị Passkey). Bản vá đầy đủ đã được kiểm chứng formal trong contracts/src và forge test.'
                : 'The deployed Fuji treasury (0x2045...d545) runs original bytecode without A1 (root snapshot check) & A3 (Passkey governance). Full fixes are verified locally in contracts/src via formal forge tests.'}
            </li>
            <li>
              <strong className="text-ink">Inter-Chain Messaging (ICM):</strong>{' '}
              {isVi
                ? 'Đã chứng minh self-relay thành công qua Avalanche Glacier Signature Aggregator và access list predicate; việc triển khai Dispatch hub/gateway đang chờ faucet testnet công khai.'
                : 'Cross-chain self-relay is verified via public Dispatch warp messages and Avalanche Glacier signature aggregator; live Dispatch gateway deployment is pending public faucet funding.'}
            </li>
            <li>
              <strong className="text-ink">AgentDojo Banking Replay:</strong>{' '}
              {isVi
                ? 'Đạt 120/128 injection bị chặn. 8 trường hợp ngoại lệ đều thuộc user_task_15 khi chính prompt của người dùng chứa số IBAN của kẻ tấn công (xung đột prompt người dùng).'
                : 'MissionPay blocked 120 of 128 financial injections. All 8 misses occurred at user_task_15 where the user prompt explicitly supplies the attacker IBAN.'}
            </li>
          </ul>
        </div>
      </section>
      </div>
    </div>
  );
}
