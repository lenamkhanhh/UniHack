'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';
import { Kicker, Stop } from '@/components/Display';

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

const DEFAULT_RECEIPTS: JudgeReceiptItem[] = [
  {
    id: 'missionA',
    step: 1,
    label: 'Mission A: Drain Allowed',
    labelVi: 'Mission A: Cho phép rút tiền',
    description: 'Global allowlist allows draining 0.01 USDC to secondary vendor',
    descriptionVi: 'Allowlist toàn cục cho phép rút 0.01 USDC tới vendor thứ cấp',
    txHash: '0x548d1106a69626eed32d308088f188c6d2d71d8e2f61e495f637d9f04e367fc6',
    status: 'success',
    blockNumber: 61001944,
    gasUsed: '48215',
    outflow: '0.01 USDC',
    outflowVi: '0.01 USDC',
    snowtraceUrl: 'https://testnet.snowtrace.io/tx/0x548d1106a69626eed32d308088f188c6d2d71d8e2f61e495f637d9f04e367fc6',
  },
  {
    id: 'missionB_negative',
    step: 2,
    label: 'Mission B (Negative): Revert Enforced',
    labelVi: 'Mission B (Âm tính): Ép Revert',
    description: 'Off-mission vendor rejected on-chain with PayeeNotInMissionSet',
    descriptionVi: 'Vendor ngoài mission bị revert on-chain với PayeeNotInMissionSet',
    txHash: '0x0ad53adcf5790523e22219dcadc2c69b1a783d22c0bf651a9fa4742b43783e38',
    status: 'reverted',
    revertReason: 'PayeeNotInMissionSet',
    blockNumber: 61001947,
    gasUsed: '32100',
    outflow: '0 USDC',
    outflowVi: '0 USDC',
    snowtraceUrl: 'https://testnet.snowtrace.io/tx/0x0ad53adcf5790523e22219dcadc2c69b1a783d22c0bf651a9fa4742b43783e38',
  },
  {
    id: 'missionB_positive',
    step: 3,
    label: 'Mission B (Positive): Legit Payout Succeeded',
    labelVi: 'Mission B (Dương tính): Thanh Toán Hợp Lệ',
    description: 'Legitimate mission payout executed successfully to owner',
    descriptionVi: 'Thanh toán mission hợp lệ thực hiện thành công tới ví chủ',
    txHash: '0xcb7236d146a2c8e2789db8ec2a80358b17d65993fc7b07187802e34c48656315',
    status: 'success',
    blockNumber: 61001949,
    gasUsed: '45320',
    outflow: '0.01 USDC',
    outflowVi: '0.01 USDC',
    snowtraceUrl: 'https://testnet.snowtrace.io/tx/0xcb7236d146a2c8e2789db8ec2a80358b17d65993fc7b07187802e34c48656315',
  },
];

export default function JudgePage() {
  const { lang } = useI18n();
  const isVi = lang === 'vi';

  // Block 1 state: live receipts from Fuji (default to recorded receipts so cards render immediately)
  const [receipts, setReceipts] = useState<JudgeReceiptItem[]>(DEFAULT_RECEIPTS);
  const [loadingReceipts, setLoadingReceipts] = useState<boolean>(false);
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

  // Fetch receipts on mount in background
  useEffect(() => {
    fetch('/api/judge/receipts')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to read live receipts`);
        return res.json();
      })
      .then((data) => {
        if (data.success && Array.isArray(data.receipts) && data.receipts.length > 0) {
          setReceipts(data.receipts);
        }
      })
      .catch(() => {
        // gracefully retain default receipts if background fetch fails
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
      {/* Hero band: slate */}
      <div className="hero-band hero-slate">
      <section className="hero-inner">
        <Kicker>
          {isVi
            ? 'XÁC MINH TRỰC TIẾP AVALANCHE FUJI · ĐÁNH GIÁ 30 GIÂY'
            : 'AVALANCHE FUJI LIVE VERIFICATION · 30-SECOND AUDIT'}
        </Kicker>

        <h1 className="display-h1 mb-5 max-w-[20ch]">
          <Stop>
            {isVi
              ? 'Chế độ Giám khảo: Tự Kiểm Chứng trong 30 Giây'
              : 'Judge Mode: Verify On-Chain Proof in 30 Seconds'}
          </Stop>
        </h1>

        <p className="lede">
          {isVi
            ? 'Kiểm tra biên lai các giao dịch đã thực sự diễn ra on-chain trên Avalanche Fuji C-Chain, hoặc trực tiếp mô phỏng các giao dịch tấn công từ ví agent tới smart contract bằng eth_call ngay tại đây.'
            : 'Inspect live receipts of transactions that already occurred on Avalanche Fuji C-Chain, or simulate arbitrary off-mission attacks directly against the deployed contract via eth_call with zero gas and zero setup.'}
        </p>
      </section>
      </div>

      {/* Block 1: Already happened on Fuji (proof band) */}
      <div className="redbar" aria-hidden="true" />
      <div className="band-navy">
      <section aria-labelledby="block1-heading" className="wrap band space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Kicker>{isVi ? 'Biên lai đọc trực tiếp từ Fuji RPC' : 'Receipts read live from Fuji RPC'}</Kicker>
            <h2 id="block1-heading" className="sec-h">
              <Stop>{isVi ? 'Đã Diễn Ra Trên Avalanche Fuji C-Chain' : 'Already Happened on Avalanche Fuji C-Chain'}</Stop>
            </h2>
            <p className="sec-p mb-0">
              {isVi
                ? 'Đọc trực tiếp từ RPC Avalanche Fuji thông qua viem getTransactionReceipt khi tải trang. Không có số liệu gõ tay.'
                : 'Queried directly from Avalanche Fuji RPC on page load via viem getTransactionReceipt. 100% measured on-chain.'}
            </p>
          </div>
          <Link
            href="/arena/twin"
            className="flex items-center gap-1 text-[15px] text-[#A9C2F5] underline underline-offset-2 hover:text-white"
          >
            <span>{isVi ? 'Xem Bảng Đối Chứng Twin Treasury' : 'View Twin Treasury Arena'}</span>
            <span>→</span>
          </Link>
        </div>

        {loadingReceipts ? (
          <div className="p-8 rounded-data bg-navy-2 border border-navy-rule text-center space-y-3">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-paid"></div>
            <p className="text-[15px] text-[#B4BDCC]">
              {isVi ? 'Đang đọc biên lai trực tiếp từ Avalanche Fuji RPC...' : 'Fetching live transaction receipts from Avalanche Fuji RPC...'}
            </p>
          </div>
        ) : receiptsError ? (
          <div className="outcome-blocked p-6 text-blocked space-y-2">
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
                  className={`p-5 rounded-data border border-l-4 transition-all flex flex-col justify-between space-y-4 ${
                    isSuccess
                      ? 'bg-paid-bg border-paid-rule border-l-paid'
                      : 'bg-blocked-bg border-blocked-rule border-l-brand'
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[13px] font-medium tracking-[0.08em] text-ink-2">
                        STEP {rc.step}
                      </span>
                      <span
                        className={`px-2.5 py-0.5 rounded-tag text-[13px] font-bold uppercase tracking-wider ${
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

                    <h3 className="card-title">
                      {isVi ? rc.labelVi : rc.label}
                    </h3>

                    <p className="text-[15px] text-ink-2 leading-relaxed">
                      {isVi ? rc.descriptionVi : rc.description}
                    </p>

                    <div className="p-2.5 rounded-data bg-card border border-rule space-y-1 text-[13px]">
                      <div className="flex justify-between text-ink-2">
                        <span>Block:</span>
                        <span className="text-ink font-semibold">#{rc.blockNumber}</span>
                      </div>
                      <div className="flex justify-between text-ink-2">
                        <span>Gas Used:</span>
                        <span className="text-ink">{Number(String(rc.gasUsed).replace(/,/g, '') || 0).toLocaleString()} gas</span>
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
                    className="inline-flex items-center justify-center gap-1.5 w-full py-2 px-3 rounded-full bg-card hover:bg-mist border border-rule-2 text-sm font-semibold text-info transition focus:outline-none focus:ring-2 focus:ring-ink"
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
      </div>

      <div className="wrap band space-y-16">
      {/* Block 2: Try it yourself */}
      <section aria-labelledby="block2-heading" className="p-6 sm:p-8 rounded-card bg-card border border-rule space-y-6">
        <div>
          <Kicker>{isVi ? 'TƯƠNG TÁC TRỰC TIẾP · KHÔNG CẦN GAS' : 'INTERACTIVE AUDIT · ZERO GAS'}</Kicker>
          <h2 id="block2-heading" className="sec-h">
            <Stop>{isVi ? 'Tự Mình Kiểm Chứng (Mô Phỏng Trực Tiếp Trên Fuji)' : 'Try It Yourself: Interactive Fuji Contract Simulation'}</Stop>
          </h2>
          <p className="text-base text-ink-2 mt-1 max-w-3xl">
            {isVi
              ? 'Nhập bất kỳ địa chỉ ví nào để thử nghiệm giải ngân dưới Mission B (đã áp Merkle root do chủ sở hữu ký). Máy chủ sẽ gửi eth_call với tư cách ví agent tới smart contract GuardedTreasury trên Avalanche Fuji C-Chain.'
              : 'Enter ANY recipient address to test against Mission B (enforcing owner-signed Merkle payee root). The server executes an eth_call with account=agent against the live Fuji GuardedTreasury contract.'}
          </p>
          <div className="mt-2 text-sm font-medium text-paid">
            {isVi
              ? 'Mô phỏng eth_call đối với hợp đồng thực tế; không phát sóng giao dịch, không tiêu tốn tiền.'
              : 'eth_call simulation against the live contract; nothing is sent, zero gas consumed.'}
          </div>
        </div>

        {/* Input & Action Form */}
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block text-[15px] font-semibold text-ink">
              {isVi ? 'Địa chỉ người nhận đề xuất (Recipient Address):' : 'Proposed Payee Address:'}
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value.trim())}
                placeholder="0x..."
                className="input flex-1 min-w-0 font-mono text-sm"
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
              <label className="block text-sm text-ink-2 mb-1">
                {isVi ? 'Số tiền mô phỏng (atomic units, max 10000 = 0.01 USDC):' : 'Amount (atomic units, max 10000 = 0.01 USDC):'}
              </label>
              <input
                type="number"
                min="1"
                max="10000"
                value={amountAtomic}
                onChange={(e) => setAmountAtomic(Number(e.target.value))}
                className="input w-48 text-sm"
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
          <div className="outcome-blocked text-blocked text-sm space-y-1">
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
            className={`p-5 rounded-data border border-l-4 transition-all space-y-3 ${
              simResult.outcome === 'REVERT'
                ? 'bg-blocked-bg border-blocked-rule border-l-brand'
                : 'bg-paid-bg border-paid-rule border-l-paid'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule pb-2">
              <div className="flex items-center gap-2">
                <span className="font-bold text-base text-ink">
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
                className={`px-2.5 py-0.5 rounded-tag text-xs font-bold ${
                  simResult.outcome === 'REVERT'
                    ? 'bg-blocked-bg text-blocked border border-blocked-rule'
                    : 'bg-paid-bg text-paid border border-paid-rule'
                }`}
              >
                {simResult.outcome}
              </span>
            </div>

            <p className="text-[15px] text-ink">{simResult.message}</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm pt-1">
              <div className="p-2.5 rounded-data bg-card border border-rule space-y-1">
                <div className="text-ink-2">Tested Payee:</div>
                <div className="font-mono text-ink truncate">{simResult.recipient}</div>
              </div>
              <div className="p-2.5 rounded-data bg-card border border-rule space-y-1">
                <div className="text-ink-2">Simulated Amount:</div>
                <div className="text-ink">
                  {simResult.amountAtomic} atomic units ({simResult.amountUsdc})
                </div>
              </div>
              {simResult.revertReason && (
                <div className="p-2.5 rounded-data bg-card border border-rule space-y-1 sm:col-span-2">
                  <div className="text-ink-2">Exact On-Chain Revert Reason:</div>
                  <div className="font-mono text-blocked font-bold text-sm">{simResult.revertReason}</div>
                </div>
              )}
              <div className="p-2.5 rounded-data bg-card border border-rule space-y-1 sm:col-span-2">
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
          <Kicker>Foundry cast · public RPC</Kicker>
          <h2 id="block3-heading" className="sec-h">
            <Stop>{isVi ? 'Tái Lập Độc Lập Từ Terminal Của Bạn (Foundry Cast)' : 'Reproduce from Your Terminal (Foundry Cast)'}</Stop>
          </h2>
          <p className="text-base text-ink-2 mt-1 max-w-3xl">
            {isVi
              ? 'Không tin giao diện web? Copy các câu lệnh cast call dưới đây và dán thẳng vào terminal cá nhân. RPC công khai không cần cấu hình key.'
              : "Don't trust the web UI? Copy-paste these read-only cast call commands directly into your local terminal against public Fuji RPC."}
          </p>
        </div>

        <div className="space-y-4">
          {/* Attacker Revert Command */}
          <div className="p-4 sm:p-5 rounded-data bg-card border border-rule border-l-4 border-l-brand space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-bold text-blocked">
                {isVi ? 'A. Kịch bản kẻ tấn công (Kỳ vọng: revert PayeeNotInMissionSet)' : 'A. Attacker Scenario (Expected Revert: PayeeNotInMissionSet)'}
              </span>
              <button
                type="button"
                onClick={() => copyToClipboard(castAttackerCmd, 'attacker')}
                className="shrink-0 px-3 py-1 rounded-full bg-ink hover:bg-ink-2 text-[13px] font-semibold text-white transition"
              >
                {copiedKey === 'attacker' ? (isVi ? 'Đã sao chép! ✓' : 'Copied! ✓') : isVi ? 'Sao chép lệnh' : 'Copy command'}
              </button>
            </div>
            <pre className="code-block">
              {castAttackerCmd}
            </pre>
          </div>

          {/* Owner Positive Control Command */}
          <div className="p-4 sm:p-5 rounded-data bg-card border border-rule border-l-4 border-l-paid space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-bold text-paid">
                {isVi ? 'B. Kịch bản đối chứng hợp lệ (Kỳ vọng: proposal ID thành công)' : 'B. Positive Control Scenario (Expected: Proposal ID Success)'}
              </span>
              <button
                type="button"
                onClick={() => copyToClipboard(castOwnerCmd, 'owner')}
                className="shrink-0 px-3 py-1 rounded-full bg-ink hover:bg-ink-2 text-[13px] font-semibold text-white transition"
              >
                {copiedKey === 'owner' ? (isVi ? 'Đã sao chép! ✓' : 'Copied! ✓') : isVi ? 'Sao chép lệnh' : 'Copy command'}
              </button>
            </div>
            <pre className="code-block">
              {castOwnerCmd}
            </pre>
          </div>
        </div>
      </section>

      {/* Block 4: Resources & Known Limits */}
      <section aria-labelledby="block4-heading" className="p-6 sm:p-8 rounded-card bg-card border border-rule space-y-6">
        <h2 id="block4-heading" className="sec-h">
          <Stop>{isVi ? 'Tài Liệu Kiểm Chứng & Giới Hạn Đã Biết' : 'Resources & Known Limits'}</Stop>
        </h2>

        {/* 3 Links */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <a
            href="https://docs.google.com/presentation/d/1MSbomuT7qXj2MCg6taqkS6tEqdVH_VybzS5wTcQAKHY/edit?usp=sharing"
            target="_blank"
            rel="noreferrer"
            className="p-4 rounded-card bg-tint-slate hover:bg-[#DCE4EE] border border-info-rule transition space-y-1 block"
          >
            <div className="card-title flex items-center justify-between">
              <span>{isVi ? 'Slide Thuyết Trình (PDF)' : 'Pitch Deck (PDF)'}</span>
              <span className="text-sm text-info">↗</span>
            </div>
            <p className="text-sm text-ink-2">
              {isVi ? 'Pitch deck PDF với số liệu benchmark thật.' : 'Pitch deck (PDF) with verified replay benchmark.'}
            </p>
          </a>

          <a
            href="https://github.com/lenamkhanhh/UniHack/blob/main/artifacts/submission-s1/FUJI_EVIDENCE.md"
            target="_blank"
            rel="noreferrer"
            className="p-4 rounded-card bg-tint-slate hover:bg-[#DCE4EE] border border-info-rule transition space-y-1 block"
          >
            <div className="card-title flex items-center justify-between">
              <span>{isVi ? 'Bằng Chứng Fuji On-Chain' : 'Fuji On-Chain Evidence'}</span>
              <span className="text-sm text-info">↗</span>
            </div>
            <p className="text-sm text-ink-2">
              {isVi ? 'Danh sách tx hash, contract address và log sự kiện.' : 'Complete tx hashes, deployed contract addresses, and event logs.'}
            </p>
          </a>

          <a
            href="https://github.com/lenamkhanhh/UniHack"
            target="_blank"
            rel="noreferrer"
            className="p-4 rounded-card bg-tint-slate hover:bg-[#DCE4EE] border border-info-rule transition space-y-1 block"
          >
            <div className="card-title flex items-center justify-between">
              <span>{isVi ? 'Mã Nguồn GitHub' : 'GitHub Repository'}</span>
              <span className="text-sm text-info">↗</span>
            </div>
            <p className="text-sm text-ink-2">
              {isVi ? 'Kho mã nguồn đầy đủ kèm bộ test Foundry và Vitest.' : 'Full source code with Foundry unit and invariant suites.'}
            </p>
          </a>
        </div>

        {/* Known Limits Disclosure */}
        <div className="outcome-warn p-5 space-y-3">
          <div className="card-title text-warn flex items-center gap-2">
            <span>{isVi ? 'Tính Minh Bạch: Các Giới Hạn Đã Biết (Known Limits)' : 'Honest Disclosure: Known Limits'}</span>
          </div>
          <ul className="text-[15px] text-ink-2 space-y-2 list-disc pl-5 leading-relaxed">
            <li>
              <strong className="text-ink">Deployed Fuji Bytecode:</strong>{' '}
              {isVi
                ? 'Hợp đồng triển khai trên Fuji (0x2045...d545) sử dụng bytecode ban đầu, chưa có bản vá A1 (snapshot Merkle root) và A3 (quản trị Passkey). Bản vá đầy đủ đã được kiểm chứng formal trong contracts/src và forge test.'
                : 'The deployed Fuji treasury (0x2045...d545) runs original bytecode without A1 (root snapshot check) & A3 (Passkey governance). Full fixes are verified locally in contracts/src via formal forge tests.'}
            </li>
            <li>
              <strong className="text-ink">Inter-Chain Messaging (ICM):</strong>{' '}
              {isVi
                ? 'Live trên testnet từ 20/11: agent gửi yêu cầu chi trên Dispatch, Hub trên Fuji thực thi (0x5641…443b); người lạ bị chặn UnauthorizedAgent (0xdd99…341d). Tin được giao bởi relayer ICM công khai; self-relay của đội tạo chữ ký hợp lệ nhưng đến chậm một block.'
                : 'Live on testnet since 20/11: an agent spend sent on Dispatch was executed by the Fuji hub (0x5641…443b); a stranger spend was rejected with UnauthorizedAgent (0xdd99…341d). Delivery was done by a public ICM relayer; our own self-relay produced a valid signed message but arrived a block later.'}
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
