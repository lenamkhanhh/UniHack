'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

interface TwinEvidence {
  timestamp: string;
  contractAddress: string;
  chainId: number;
  mode: string;
  forkBlockNumber?: number;
  controlledVendorAddress: string;
  legitPayeeAddress: string;
  agentAddress: string;
  ownerAddress: string;
  perTxCapUsdc: string;
  autoPayoutRule: string;
  missionA: {
    id: string;
    name: string;
    description: string;
    capUsdc: string;
    payeeRoot: string;
    recipientAllowlisted: boolean;
    simulationOutcome: string;
    statusDescription: string;
    balanceDeltaUsdc: string;
    txHash?: string;
  };
  missionB: {
    id: string;
    name: string;
    description: string;
    capUsdc: string;
    payeeRoot: string;
    negativeControl: {
      recipient: string;
      isAllowlistedGlobally: boolean;
      isInMissionRoot: boolean;
      simulationOutcome: string;
      revertReason: string;
      balanceDeltaUsdc: string;
      statusDescription: string;
      txHash?: string;
    };
    positiveControl: {
      recipient: string;
      isAllowlistedGlobally: boolean;
      isInMissionRoot: boolean;
      simulationOutcome: string;
      balanceDeltaUsdc: string;
      statusDescription: string;
      txHash?: string;
    };
  };
  plannedTransactions: {
    step: number;
    description: string;
    signer: string;
    estimatedGas: string;
    estimatedCostAvax: string;
    usdcOutflow: string;
  }[];
  totalEstimatedGasAvax: string;
  totalUsdcBudget: string;
}

export default function TwinTreasuryPage() {
  const [lang, setLang] = useState<'vi' | 'en'>('vi');
  const [loading, setLoading] = useState(true);
  const [evidenceData, setEvidenceData] = useState<{
    exists: boolean;
    status: string;
    data?: TwinEvidence;
  } | null>(null);

  useEffect(() => {
    fetch('/api/arena/twin')
      .then((res) => res.json())
      .then((data) => {
        setEvidenceData(data);
        setLoading(false);
      })
      .catch(() => {
        setEvidenceData({ exists: false, status: 'NOT_RUN' });
        setLoading(false);
      });
  }, []);

  const t = {
    vi: {
      badge: 'AVALANCHE FUJI • ĐẤU TRƯỜNG THỰC TẾ',
      title: 'Twin Treasury: Allowlist Vẫn Mất Tiền, Mission Thì Không',
      subtitle:
        'Cùng một đòn tấn công hoá đơn giả mạo chỉ định vendor quen thuộc. Xem kết quả đối chiếu thực tế trên hợp đồng GuardedTreasury.',
      switchLang: 'English',
      notRunBadge: 'CHƯA CHẠY ON-CHAIN (NOT RUN)',
      notRunNotice:
        'Chưa có file bằng chứng evidence/twin/twin.json được ghi nhận từ blockchain. Giao dịch phát sóng live đang dừng chờ lệnh phê duyệt từ Owner (TWIN_ALLOW_BROADCAST=1). Dưới đây là kết quả mô phỏng Anvil Fork và kế hoạch thực thi.',
      recordedBadge: 'BẰNG CHỨNG LIVE ĐÃ XÁC MINH TRÊN FUJI',
      vendorNotice:
        'Địa chỉ vendor quen thuộc thuộc quyền kiểm soát (0xE90c...1aEA) được bật trong allowlist chung nhưng KHÔNG nằm trong Merkle root của Mission B.',
      colATitle: 'Kho A: Chế độ Allowlist Chung',
      colADesc: 'Hợp đồng này ở chế độ allowlist chung (payee root = 0x0)',
      colALeak: 'BỊ RÚT TIỀN (+0.01 USDC)',
      colBTitle: 'Kho B: Mission-Scoped Guard (MissionPay)',
      colBDesc: 'Tập người nhận theo từng mission do Owner ký Merkle Root',
      colBBlock: 'CHẶN RÚT SAI MỤC TIÊU & TRẢ ĐÚNG VENDOR',
      negControlTitle: '1. Kiểm soát tiêu cực (Kẻ tấn công chuyển hướng thanh toán):',
      negControlDesc:
        'Đề xuất 0.01 USDC tới vendor thuộc allowlist chung nhưng ngoài mission set -> REVERT: PayeeNotInMissionSet (0 USDC thất thoát).',
      posControlTitle: '2. Kiểm soát tích cực (Thanh toán vendor hợp lệ của mission):',
      posControlDesc:
        'Đề xuất 0.01 USDC tới payee hợp lệ kèm Merkle proof hợp lệ -> THÀNH CÔNG (+0.01 USDC chi trả đúng người).',
      txPlanTitle: 'Kế hoạch 8 giao dịch thực tế chờ Owner duyệt (Ngân sách <= 0.05 USDC)',
      step: 'Bước',
      signer: 'Người ký',
      estGas: 'Ước tính Gas',
      conclusionTitle: 'Thông điệp cốt lõi từ Twin Treasury',
      conclusionText:
        'Allowlist chung của tổ chức không thể ngăn chặn tấn công prompt injection khi kẻ tấn công chỉ định một vendor hợp lệ khác của công ty. Chỉ khi ràng buộc tập người nhận theo từng mission on-chain qua Merkle root, hợp đồng mới chặn đứng thanh toán chệch hướng trong khi vẫn bảo đảm thanh toán thông suốt cho vendor chính thức của mission.',
      backHome: '← Quay lại Trang Chủ',
      viewContract: 'Xem Contract trên Snowtrace',
    },
    en: {
      badge: 'AVALANCHE FUJI • LIVE ARENA',
      title: 'Twin Treasury: Allowlist Still Drains, Mission Reverts',
      subtitle:
        'Same poisoned invoice prompt injection specifying a recognized company vendor. Real architectural comparison on Avalanche Fuji GuardedTreasury.',
      switchLang: 'Tiếng Việt',
      notRunBadge: 'NOT RUN ON-CHAIN',
      notRunNotice:
        'No evidence file (evidence/twin/twin.json) has been recorded from the blockchain yet. Live broadcast is pending owner approval (TWIN_ALLOW_BROADCAST=1). Anvil fork simulation results and live execution plan are displayed below.',
      recordedBadge: 'LIVE ON-CHAIN EVIDENCE RECORDED ON FUJI',
      vendorNotice:
        'Controlled vendor address (0xE90c...1aEA) is allowlisted globally on-chain but strictly NOT in Mission B payee root.',
      colATitle: 'Treasury A: Global Allowlist Mode',
      colADesc: 'This contract in global-allowlist mode (payee root = 0x0)',
      colALeak: 'FUNDS DRAINED (+0.01 USDC)',
      colBTitle: 'Treasury B: Mission-Scoped Guard (MissionPay)',
      colBDesc: 'Owner-signed Merkle payee root per mission',
      colBBlock: 'BLOCKS DIVERTED & PAYS LEGIT PAYEE',
      negControlTitle: '1. Negative Control (Attacker diverted payment):',
      negControlDesc:
        'Propose 0.01 USDC to globally allowlisted vendor outside mission -> REVERTS: PayeeNotInMissionSet (0 USDC leaked).',
      posControlTitle: '2. Positive Control (Legitimate mission payee):',
      posControlDesc:
        'Propose 0.01 USDC to legitimate mission payee with valid Merkle proof -> SUCCEEDS (+0.01 USDC paid correctly).',
      txPlanTitle: '8-Step Live Transaction Plan Pending Owner Approval (Budget <= 0.05 USDC)',
      step: 'Step',
      signer: 'Signer',
      estGas: 'Estimated Gas',
      conclusionTitle: 'Core Takeaway from Twin Treasury',
      conclusionText:
        'Global allowlists fail against indirect prompt injection when an attacker instructs the agent to pay another recognized vendor. Only mission-scoped payee roots bound on-chain block diverted payments while safely executing payouts to legitimate vendors.',
      backHome: '← Back to Home',
      viewContract: 'View Contract on Snowtrace',
    },
  }[lang];

  const hasLiveEvidence = Boolean(evidenceData?.exists && evidenceData?.data);
  const evidence = evidenceData?.data;

  return (
    <main className="min-h-screen bg-[#07090e] text-white p-4 md:p-8 font-sans flex flex-col items-center">
      <div className="w-full max-w-5xl flex flex-col space-y-6">
        {/* Navigation & Language Toggle */}
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="text-xs text-gray-400 hover:text-white transition-colors flex items-center space-x-1 focus:ring-2 focus:ring-red-500 rounded px-2 py-1"
            aria-label="Back to Homepage"
          >
            <span>{t.backHome}</span>
          </Link>
          <button
            onClick={() => setLang(lang === 'vi' ? 'en' : 'vi')}
            className="text-xs px-3 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full font-mono transition-colors focus:ring-2 focus:ring-red-500"
            aria-label="Toggle language"
          >
            {t.switchLang}
          </button>
        </div>

        {/* Header Banner */}
        <div className="border border-white/10 bg-white/[0.02] rounded-2xl p-6 text-center space-y-3 relative overflow-hidden">
          <div className="inline-flex items-center space-x-2 px-3 py-1 bg-red-500/10 text-red-400 text-xs font-mono font-semibold rounded-full border border-red-500/30">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span>{t.badge}</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white">
            {t.title}
          </h1>
          <p className="text-sm text-gray-300 max-w-2xl mx-auto">{t.subtitle}</p>

          {/* Status Badge */}
          <div className="pt-2">
            {hasLiveEvidence ? (
              <span className="inline-block px-3 py-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 rounded-lg text-xs font-mono font-bold">
                {t.recordedBadge}
              </span>
            ) : (
              <div className="inline-block px-4 py-2 bg-amber-500/10 border border-amber-500/30 rounded-xl text-left max-w-2xl">
                <div className="flex items-center space-x-2 text-amber-400 text-xs font-mono font-bold">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  <span>{t.notRunBadge}</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">{t.notRunNotice}</p>
              </div>
            )}
          </div>
        </div>

        {/* Precondition callout */}
        <div className="border border-white/5 bg-white/[0.01] rounded-xl p-4 text-xs font-mono text-gray-400 flex items-center justify-between flex-wrap gap-2">
          <span>{t.vendorNotice}</span>
          <a
            href="https://testnet.snowtrace.io/address/0x20451c1e2dCD83F166B4f22868BAdECb5868d545"
            target="_blank"
            rel="noopener noreferrer"
            className="text-red-400 hover:text-red-300 underline focus:ring-1 focus:ring-red-400 rounded"
          >
            {t.viewContract} ↗
          </a>
        </div>

        {/* Twin Columns Comparison */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Column A: Global Allowlist Mode */}
          <div
            className="border border-red-500/30 bg-red-950/10 rounded-2xl p-6 flex flex-col justify-between space-y-6"
            tabIndex={0}
            role="region"
            aria-label="Treasury A: Global Allowlist Mode"
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-red-400 font-bold uppercase tracking-wider">
                  MISSION A • twin.allowlist.v1
                </span>
                <span className="px-2 py-0.5 bg-red-500/20 text-red-400 border border-red-500/40 rounded text-[11px] font-mono">
                  {t.colALeak}
                </span>
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">{t.colATitle}</h2>
                <p className="text-xs text-gray-400 mt-1">{t.colADesc}</p>
              </div>

              <div className="bg-black/40 border border-red-500/20 rounded-xl p-4 space-y-2 font-mono text-xs">
                <div className="text-gray-400">
                  payeeRoot:{' '}
                  <span className="text-white">
                    0x0000000000000000000000000000000000000000000000000000000000000000
                  </span>
                </div>
                <div className="text-gray-400">
                  recipientAllowlist(0xE90c...):{' '}
                  <span className="text-emerald-400">true (Globally Allowlisted)</span>
                </div>
                <div className="text-gray-400">
                  call:{' '}
                  <span className="text-red-300">
                    propose(opA, 0xE90c..., 10000, twin.allowlist.v1, reason)
                  </span>
                </div>
                <div className="text-gray-400 pt-2 border-t border-white/5">
                  Result:{' '}
                  <span className="text-red-400 font-bold">
                    SUCCESS (Auto-Payout Executed: +0.010000 USDC Drained)
                  </span>
                </div>
              </div>

              <p className="text-xs text-gray-300 leading-relaxed">
                {lang === 'vi'
                  ? 'Kẻ tấn công lừa agent bằng invoice giả mang địa chỉ vendor quen thuộc. Do hợp đồng chỉ kiểm tra danh sách cho phép chung và số tiền (0.01 USDC) <= perTxCap (5.0 USDC), giao dịch tự động chuyển tiền ngay lập tức trong propose()!'
                  : 'The attacker tricks the agent with a poisoned invoice naming a recognized vendor. Because the contract only checks a global allowlist and the amount (0.01 USDC) <= perTxCap (5.0 USDC), funds are immediately drained via safeTransfer in propose().'}
              </p>
            </div>

            <div className="pt-4 border-t border-red-500/20 text-xs font-mono text-gray-400">
              {hasLiveEvidence && evidence?.missionA?.txHash ? (
                <a
                  href={`https://testnet.snowtrace.io/tx/${evidence.missionA.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-red-400 hover:underline"
                >
                  Tx: {evidence.missionA.txHash.slice(0, 16)}... ↗
                </a>
              ) : (
                <span>Fork Simulation: Verified on Block #{evidence?.forkBlockNumber || '60993234'}</span>
              )}
            </div>
          </div>

          {/* Column B: Mission-Scoped Guard */}
          <div
            className="border border-emerald-500/30 bg-emerald-950/10 rounded-2xl p-6 flex flex-col justify-between space-y-6"
            tabIndex={0}
            role="region"
            aria-label="Treasury B: Mission-Scoped Guard"
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-emerald-400 font-bold uppercase tracking-wider">
                  MISSION B • twin.mission.v1
                </span>
                <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 rounded text-[11px] font-mono">
                  {t.colBBlock}
                </span>
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">{t.colBTitle}</h2>
                <p className="text-xs text-gray-400 mt-1">{t.colBDesc}</p>
              </div>

              {/* Negative Control Box */}
              <div className="bg-black/40 border border-emerald-500/20 rounded-xl p-3 space-y-2 font-mono text-xs">
                <div className="text-amber-400 font-semibold">{t.negControlTitle}</div>
                <div className="text-gray-400">
                  verifyMerkleProof(0xE90c... in rootB):{' '}
                  <span className="text-red-400 font-bold">false (Not a leaf)</span>
                </div>
                <div className="text-gray-400">
                  call:{' '}
                  <span className="text-amber-300">
                    proposeWithProof(opB1, 0xE90c..., 10000, twin.mission.v1, ..., [])
                  </span>
                </div>
                <div className="text-gray-400">
                  Result:{' '}
                  <span className="text-emerald-400 font-bold">
                    REVERT: "PayeeNotInMissionSet" (0.00 USDC Leaked)
                  </span>
                </div>
              </div>

              {/* Positive Control Box */}
              <div className="bg-black/40 border border-emerald-500/20 rounded-xl p-3 space-y-2 font-mono text-xs">
                <div className="text-emerald-400 font-semibold">{t.posControlTitle}</div>
                <div className="text-gray-400">
                  verifyMerkleProof(0x83F5... in rootB):{' '}
                  <span className="text-emerald-400 font-bold">true (Valid proof)</span>
                </div>
                <div className="text-gray-400">
                  call:{' '}
                  <span className="text-emerald-300">
                    proposeWithProof(opB2, 0x83F5..., 10000, twin.mission.v1, ..., proof)
                  </span>
                </div>
                <div className="text-gray-400">
                  Result:{' '}
                  <span className="text-emerald-400 font-bold">
                    SUCCESS (Auto-Payout Executed: +0.010000 USDC Paid)
                  </span>
                </div>
              </div>

              <p className="text-xs text-gray-300 leading-relaxed">
                {lang === 'vi'
                  ? 'Khi kẻ tấn công cố chuyển tiền cho vendor ngoài mission, hợp đồng đối chiếu chữ ký Merkle root của mission và từ chối ngay lập tức (PayeeNotInMissionSet). Đồng thời, vendor chính thức của mission có Merkle proof hợp lệ vẫn được thanh toán bình thường.'
                  : 'When the attacker attempts to divert payment to a non-mission vendor, the contract validates the Merkle root on-chain and rejects the transaction with PayeeNotInMissionSet. Simultaneously, the authorized mission payee with valid proof is successfully paid.'}
              </p>
            </div>

            <div className="pt-4 border-t border-emerald-500/20 text-xs font-mono text-gray-400">
              {hasLiveEvidence && evidence?.missionB?.negativeControl?.txHash ? (
                <a
                  href={`https://testnet.snowtrace.io/tx/${evidence.missionB.negativeControl.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-400 hover:underline"
                >
                  Tx: {evidence.missionB.negativeControl.txHash.slice(0, 16)}... ↗
                </a>
              ) : (
                <span>Fork Simulation: Verified on Block #{evidence?.forkBlockNumber || '60993234'}</span>
              )}
            </div>
          </div>
        </div>

        {/* Planned Live Transactions Section */}
        <div className="border border-white/10 bg-white/[0.02] rounded-2xl p-6 space-y-4">
          <h3 className="text-sm font-bold text-white font-mono uppercase tracking-wider">
            {t.txPlanTitle}
          </h3>
          <div className="space-y-3 font-mono text-xs">
            <div className="border border-white/5 bg-black/30 rounded-lg p-3 flex flex-col md:flex-row md:items-center justify-between gap-2">
              <div>
                <span className="text-emerald-400 font-bold">Step 1:</span>{' '}
                <span>Owner enables global allowlist for controlled vendor (0xE90c...1aEA)</span>
              </div>
              <div className="text-gray-400">Signer: Owner • Est. Gas: ~45,000 (~0.0012 AVAX)</div>
            </div>

            <div className="border border-white/5 bg-black/30 rounded-lg p-3 flex flex-col md:flex-row md:items-center justify-between gap-2">
              <div>
                <span className="text-emerald-400 font-bold">Step 2:</span>{' '}
                <span>Owner enables global allowlist for legitimate payee (0x83F5...13B5)</span>
              </div>
              <div className="text-gray-400">Signer: Owner • Est. Gas: ~45,000 (~0.0012 AVAX)</div>
            </div>

            <div className="border border-white/5 bg-black/30 rounded-lg p-3 flex flex-col md:flex-row md:items-center justify-between gap-2">
              <div>
                <span className="text-red-400 font-bold">Step 3:</span>{' '}
                <span>Owner creates Mission A (twin.allowlist.v1, cap=0.02 USDC, root=0x0)</span>
              </div>
              <div className="text-gray-400">Signer: Owner • Est. Gas: ~85,000 (~0.0022 AVAX)</div>
            </div>

            <div className="border border-white/5 bg-black/30 rounded-lg p-3 flex flex-col md:flex-row md:items-center justify-between gap-2">
              <div>
                <span className="text-emerald-400 font-bold">Step 4:</span>{' '}
                <span>Owner creates Mission B (twin.mission.v1, cap=0.02 USDC)</span>
              </div>
              <div className="text-gray-400">Signer: Owner • Est. Gas: ~85,000 (~0.0022 AVAX)</div>
            </div>

            <div className="border border-white/5 bg-black/30 rounded-lg p-3 flex flex-col md:flex-row md:items-center justify-between gap-2">
              <div>
                <span className="text-emerald-400 font-bold">Step 5:</span>{' '}
                <span>Owner sets Mission B payee root to legit payee Merkle leaf</span>
              </div>
              <div className="text-gray-400">Signer: Owner • Est. Gas: ~45,000 (~0.0012 AVAX)</div>
            </div>

            <div className="border border-white/5 bg-black/30 rounded-lg p-3 flex flex-col md:flex-row md:items-center justify-between gap-2">
              <div>
                <span className="text-red-400 font-bold">Step 6:</span>{' '}
                <span>Agent proposes 0.01 USDC to vendor under Mission A (Vulnerable: Auto-payout)</span>
              </div>
              <div className="text-gray-400">
                Signer: Agent • Est. Gas: ~110,000 (~0.0028 AVAX) • Outflow: 0.01 USDC
              </div>
            </div>

            <div className="border border-white/5 bg-black/30 rounded-lg p-3 flex flex-col md:flex-row md:items-center justify-between gap-2">
              <div>
                <span className="text-emerald-400 font-bold">Step 7:</span>{' '}
                <span>Agent proposes 0.01 USDC to vendor under Mission B (Protected: Revert)</span>
              </div>
              <div className="text-gray-400">
                Signer: Agent • Est. Gas: ~45,000 (~0.0012 AVAX) • Outflow: 0.00 USDC
              </div>
            </div>

            <div className="border border-white/5 bg-black/30 rounded-lg p-3 flex flex-col md:flex-row md:items-center justify-between gap-2">
              <div>
                <span className="text-emerald-400 font-bold">Step 8:</span>{' '}
                <span>Agent proposes 0.01 USDC to legit payee under Mission B (Positive Control)</span>
              </div>
              <div className="text-gray-400">
                Signer: Agent • Est. Gas: ~110,000 (~0.0028 AVAX) • Outflow: 0.01 USDC
              </div>
            </div>
          </div>
          <div className="text-xs text-gray-400 pt-2 flex justify-between items-center font-mono">
            <span>Total Gas: ~0.0148 AVAX | Total USDC: 0.02 USDC</span>
            <span className="text-emerald-400">Within Budget (&le; 0.05 USDC)</span>
          </div>
        </div>

        {/* Conclusion / Takeaway */}
        <div className="border border-white/10 bg-gradient-to-r from-red-950/20 via-black to-emerald-950/20 rounded-2xl p-6 text-center space-y-2">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono">
            {t.conclusionTitle}
          </h3>
          <p className="text-xs text-gray-300 max-w-3xl mx-auto leading-relaxed">
            {t.conclusionText}
          </p>
        </div>
      </div>
    </main>
  );
}
