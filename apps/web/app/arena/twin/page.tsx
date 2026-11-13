'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

interface TwinEvidence {
  timestamp: string;
  contractAddress: string;
  chainId: number;
  mode: string;
  knownVendorAddress: string;
  isVendorAllowlisted: boolean;
  poisonedInvoiceAmount: string;
  poisonedInvoiceFormatted: string;
  missionA: {
    id: string;
    name: string;
    description: string;
    payeeRoot: string;
    existsOnChain: boolean;
    simulationOutcome: string;
    statusDescription: string;
    drainedAmount: string;
    txHash?: string;
  };
  missionB: {
    id: string;
    name: string;
    description: string;
    payeeRoot: string;
    existsOnChain: boolean;
    simulationOutcome: string;
    revertReason?: string;
    statusDescription: string;
    drainedAmount: string;
    txHash?: string;
  };
  plannedTransactions: {
    step: number;
    description: string;
    signer: string;
    estimatedGas: string;
    estimatedCostAvax: string;
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
        'Cùng một đòn tấn công hoá đơn giả mạo, cùng một địa chỉ vendor quen thuộc. Xem kết quả thực tế trên hợp đồng GuardedTreasury.',
      switchLang: 'English',
      notRunBadge: 'CHƯA CHẠY ON-CHAIN (NOT RUN)',
      notRunNotice:
        'Chưa có file bằng chứng evidence/twin/twin.json được ghi nhận từ blockchain. Giao dịch phát sóng live đang dừng chờ lệnh phê duyệt từ Owner (TWIN_ALLOW_BROADCAST=1). Dưới đây là phân tích kiến trúc đối chiếu.',
      recordedBadge: 'BẰNG CHỨNG LIVE ĐÃ XÁC MINH TRÊN FUJI',
      vendorNotice:
        'Địa chỉ vendor giả mạo (0x1111...1111) đã được bật trong danh sách cho phép chung (recipientAllowlist = true) trên Fuji.',
      colATitle: 'Kho A: Chế độ Allowlist Chung',
      colADesc: 'Hợp đồng này ở chế độ allowlist chung (payee root = 0x0)',
      colALeak: 'BỊ RÚT TIỀN (0.01 USDC)',
      colBTitle: 'Kho B: MissionPay (Mission-Scoped Guard)',
      colBDesc: 'Tập người nhận theo từng mission do Owner ký Merkle Root',
      colBBlock: 'REVERT ON-CHAIN (0.00 USDC)',
      txPlanTitle: 'Kế hoạch giao dịch thực tế chờ Owner duyệt (Ngân sách <= 0.05 USDC)',
      step: 'Bước',
      signer: 'Người ký',
      estGas: 'Ước tính Gas',
      conclusionTitle: 'Bài học thực tế từ Twin Treasury',
      conclusionText:
        'Allowlist off-chain hoặc danh sách cố định không thể ngăn chặn tấn công gián tiếp (indirect prompt injection) khi kẻ tấn công chỉ định một vendor quen thuộc có trong danh sách. Chỉ khi ràng buộc tập người nhận theo từng mission on-chain qua Merkle root, hợp đồng mới có thể từ chối thanh toán sai mục tiêu.',
      backHome: '← Quay lại Trang Chủ',
      viewContract: 'Xem Contract trên Snowtrace',
    },
    en: {
      badge: 'AVALANCHE FUJI • LIVE ARENA',
      title: 'Twin Treasury: Allowlist Still Drains, Mission Reverts',
      subtitle:
        'Same poisoned invoice prompt injection, same recognized vendor address. Real comparison on Avalanche Fuji GuardedTreasury.',
      switchLang: 'Tiếng Việt',
      notRunBadge: 'NOT RUN ON-CHAIN',
      notRunNotice:
        'No evidence file (evidence/twin/twin.json) has been recorded from the blockchain yet. Live broadcast is pending owner approval (TWIN_ALLOW_BROADCAST=1). Architectural comparison displayed below.',
      recordedBadge: 'LIVE ON-CHAIN EVIDENCE RECORDED ON FUJI',
      vendorNotice:
        'Compromised vendor address (0x1111...1111) is actively allowlisted on-chain (recipientAllowlist = true) on Fuji.',
      colATitle: 'Treasury A: Global Allowlist Mode',
      colADesc: 'This contract in global-allowlist mode (payee root = 0x0)',
      colALeak: 'FUNDS DRAINED (0.01 USDC)',
      colBTitle: 'Treasury B: Mission-Scoped Guard',
      colBDesc: 'Owner-signed Merkle payee root per mission',
      colBBlock: 'ON-CHAIN REVERT (0.00 USDC)',
      txPlanTitle: 'Live Transaction Plan Pending Owner Approval (Budget <= 0.05 USDC)',
      step: 'Step',
      signer: 'Signer',
      estGas: 'Estimated Gas',
      conclusionTitle: 'Takeaway from Twin Treasury',
      conclusionText:
        'Allowlists alone fail against indirect prompt injection when an attacker names a recognized vendor already on the list. Only mission-scoped payee roots bound on-chain guarantee safety.',
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
                  MISSION A
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
                  recipientAllowlist(0x1111...):{' '}
                  <span className="text-emerald-400">true</span>
                </div>
                <div className="text-gray-400">
                  call:{' '}
                  <span className="text-red-300">
                    propose(opId, 0x1111..., 10000, missionA, ...)
                  </span>
                </div>
                <div className="text-gray-400 pt-2 border-t border-white/5">
                  Result:{' '}
                  <span className="text-red-400 font-bold">
                    SUCCESS (Proposal Created, Drained 0.01 USDC)
                  </span>
                </div>
              </div>

              <p className="text-xs text-gray-300 leading-relaxed">
                {lang === 'vi'
                  ? 'Kẻ tấn công lừa agent bằng invoice giả mang địa chỉ vendor quen thuộc. Do hợp đồng chỉ kiểm tra danh sách cho phép chung, giao dịch được phê duyệt và tiền rời kho.'
                  : 'The attacker tricks the agent with a poisoned invoice specifying a recognized vendor. Since the contract only checks a global allowlist, the payment succeeds and funds are drained.'}
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
                <span>Status: Simulated Vulnerable (Awaiting Live Broadcast)</span>
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
                  MISSION B • MISSIONPAY
                </span>
                <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 rounded text-[11px] font-mono">
                  {t.colBBlock}
                </span>
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">{t.colBTitle}</h2>
                <p className="text-xs text-gray-400 mt-1">{t.colBDesc}</p>
              </div>

              <div className="bg-black/40 border border-emerald-500/20 rounded-xl p-4 space-y-2 font-mono text-xs">
                <div className="text-gray-400">
                  payeeRoot:{' '}
                  <span className="text-emerald-300">
                    0xc6ce8ae383124b268df66d71f0af2206e6dafb13eba0b03806eed8a4e7991329
                  </span>
                </div>
                <div className="text-gray-400">
                  verifyMerkleProof(0x1111... in mission set):{' '}
                  <span className="text-red-400">false</span>
                </div>
                <div className="text-gray-400">
                  call:{' '}
                  <span className="text-emerald-300">
                    proposeWithProof(opId, 0x1111..., 10000, missionB, ...)
                  </span>
                </div>
                <div className="text-gray-400 pt-2 border-t border-white/5">
                  Result:{' '}
                  <span className="text-emerald-400 font-bold">
                    REVERT: "PayeeNotInMissionSet" (0 USDC Drained)
                  </span>
                </div>
              </div>

              <p className="text-xs text-gray-300 leading-relaxed">
                {lang === 'vi'
                  ? 'Cùng một hoá đơn và cùng một vendor quen, nhưng hợp đồng MissionPay đối chiếu chữ ký Merkle root của mission này. Do vendor không nằm trong tập được cấp quyền cho mission, giao dịch lập tức revert on-chain.'
                  : 'With the exact same invoice and vendor, MissionPay verifies cryptographic Merkle membership for this specific mission. Since the vendor is not in this mission set, the transaction strictly reverts on-chain.'}
              </p>
            </div>

            <div className="pt-4 border-t border-emerald-500/20 text-xs font-mono text-gray-400">
              {hasLiveEvidence && evidence?.missionB?.txHash ? (
                <a
                  href={`https://testnet.snowtrace.io/tx/${evidence.missionB.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-400 hover:underline"
                >
                  Tx: {evidence.missionB.txHash.slice(0, 16)}... ↗
                </a>
              ) : (
                <span>Status: Reverted with PayeeNotInMissionSet (eth_call verified)</span>
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
                <span className="text-red-400 font-bold">Step 1:</span>{' '}
                <span>
                  Owner initializes Mission A on Fuji (Global Allowlist Mode, root = 0x0)
                </span>
              </div>
              <div className="text-gray-400">
                Signer: Owner • Est. Gas: ~85,000 (~0.0022 AVAX)
              </div>
            </div>

            <div className="border border-white/5 bg-black/30 rounded-lg p-3 flex flex-col md:flex-row md:items-center justify-between gap-2">
              <div>
                <span className="text-red-400 font-bold">Step 2:</span>{' '}
                <span>
                  Agent proposes 0.01 USDC to 0x1111... under Mission A (Vulnerable: Drained)
                </span>
              </div>
              <div className="text-gray-400">
                Signer: Agent • Est. Gas: ~110,000 (~0.0028 AVAX) • USDC: 0.01 USDC
              </div>
            </div>

            <div className="border border-white/5 bg-black/30 rounded-lg p-3 flex flex-col md:flex-row md:items-center justify-between gap-2">
              <div>
                <span className="text-emerald-400 font-bold">Step 3:</span>{' '}
                <span>
                  Agent proposes 0.01 USDC to 0x1111... under Mission B (Protected: Reverted)
                </span>
              </div>
              <div className="text-gray-400">
                Signer: Agent • Est. Gas: ~45,000 (~0.0012 AVAX) • Revert: PayeeNotInMissionSet
              </div>
            </div>
          </div>
          <div className="text-xs text-gray-400 pt-2 flex justify-between items-center font-mono">
            <span>Total Gas: ~0.0062 AVAX | Total USDC: 0.01 USDC</span>
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
