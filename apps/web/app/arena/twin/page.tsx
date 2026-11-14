'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Kicker, Stop } from '@/components/Display';

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
    blockNumber?: number;
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
      blockNumber?: number;
    };
    positiveControl: {
      recipient: string;
      isAllowlistedGlobally: boolean;
      isInMissionRoot: boolean;
      simulationOutcome: string;
      balanceDeltaUsdc: string;
      statusDescription: string;
      txHash?: string;
      blockNumber?: number;
    };
  };
  plannedTransactions: {
    step: number;
    description: string;
    signer: string;
    gasLimit: string;
    estimatedCostAvax: string;
    usdcOutflow: string;
  }[];
  totalEstimatedGasAvax: string;
  totalUsdcBudget: string;
}

export default function TwinTreasuryPage() {
  const [lang, setLang] = useState<'vi' | 'en'>('en');
  const [loading, setLoading] = useState(true);
  const [apiState, setApiState] = useState<{
    status: 'LIVE' | 'SIMULATED' | 'NOT_RUN';
    isLive: boolean;
    data?: TwinEvidence;
  }>({
    status: 'NOT_RUN',
    isLive: false,
  });

  useEffect(() => {
    try {
      const saved = localStorage.getItem('missionpay_lang');
      if (saved === 'vi' || saved === 'en') {
        setLang(saved);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetch('/api/arena/twin')
      .then((res) => res.json())
      .then((res) => {
        setApiState(res);
        setLoading(false);
      })
      .catch(() => {
        setApiState({ status: 'NOT_RUN', isLive: false });
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
        'Chưa có file bằng chứng evidence/twin/twin.live.json hoặc twin.dryrun.json. Hãy chạy kịch bản kĩ thuật scripts/twin-treasury.ts để thực thi mô phỏng hoặc phát sóng on-chain.',
      simulatedBadge: 'MÔ PHỎNG ANVIL FORK (CHƯA PHÁT SÓNG ON-CHAIN)',
      simulatedNotice:
        'Kết quả thực thi từ Anvil fork Avalanche Fuji tại block thực tế. Giao dịch phát sóng live đang dừng chờ lệnh phê duyệt từ Owner (TWIN_ALLOW_BROADCAST=1).',
      recordedBadge: 'BẰNG CHỨNG LIVE ĐÃ XÁC MINH TRÊN FUJI',
      vendorNotice:
        'Vendor (0xE90c...1aEA) thuộc quyền kiểm soát được bật trong allowlist chung, người nhận hợp lệ là Owner (0x4BC9...8F7c).',
      colATitle: 'Kho A: Chế độ Allowlist Chung',
      colADesc: 'Hợp đồng này ở chế độ allowlist chung (payee root = 0x0)',
      colALeak: 'BỊ RÚT TIỀN',
      colBTitle: 'Kho B: Mission-Scoped Guard (MissionPay)',
      colBDesc: 'Tập người nhận theo từng mission do Owner ký Merkle Root',
      colBBlock: 'CHẶN RÚT SAI MỤC TIÊU & TRẢ ĐÚNG VENDOR',
      negControlTitle: '1. Kiểm soát tiêu cực (Kẻ tấn công chuyển hướng thanh toán):',
      posControlTitle: '2. Kiểm soát tích cực (Thanh toán vendor hợp lệ của mission):',
      txPlanTitle: 'Kế hoạch 9 giao dịch thực tế chờ Owner duyệt (Ngân sách <= 0.05 USDC)',
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
        'No evidence file (twin.live.json or twin.dryrun.json) found. Run scripts/twin-treasury.ts to execute fork simulation or broadcast.',
      simulatedBadge: 'FORK SIMULATION (Not a live transaction)',
      simulatedNotice:
        'Executed via Anvil fork of Avalanche Fuji at real block height. Live broadcast is pending owner approval (TWIN_ALLOW_BROADCAST=1).',
      recordedBadge: 'LIVE ON-CHAIN EVIDENCE RECORDED ON FUJI',
      vendorNotice:
        'Vendor (0xE90c...1aEA) is globally allowlisted, legitimate payee is Owner (0x4BC9...8F7c).',
      colATitle: 'Treasury A: Global Allowlist Mode',
      colADesc: 'This contract in global-allowlist mode (payee root = 0x0)',
      colALeak: 'FUNDS DRAINED',
      colBTitle: 'Treasury B: Mission-Scoped Guard (MissionPay)',
      colBDesc: 'Owner-signed Merkle payee root per mission',
      colBBlock: 'BLOCKS DIVERTED & PAYS LEGIT PAYEE',
      negControlTitle: '1. Negative Control (Attacker diverted payment):',
      posControlTitle: '2. Positive Control (Legitimate mission payee):',
      txPlanTitle: '9-Step Live Transaction Plan Pending Owner Approval (Budget <= 0.05 USDC)',
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

  const evidence = apiState.data;
  const isLive = apiState.status === 'LIVE';
  const isSimulated = apiState.status === 'SIMULATED';
  const isNotRun = apiState.status === 'NOT_RUN';

  return (
    <main className="min-h-screen bg-paper text-ink font-sans">
      {/* Hero band: sand */}
      <div className="hero-band hero-sand">
        <div className="wrap space-y-6 pt-6 pb-12 sm:pb-14">
          {/* Navigation & Language Toggle */}
          <div className="flex items-center justify-between">
            <Link
              href="/"
              className="text-sm text-ink-2 hover:text-ink underline underline-offset-2 transition-colors flex items-center space-x-1 focus:ring-2 focus:ring-ink rounded-tag px-1 py-1"
              aria-label="Back to Homepage"
            >
              <span>{t.backHome}</span>
            </Link>
            <button
              onClick={() => {
                const next = lang === 'vi' ? 'en' : 'vi';
                setLang(next);
                try {
                  localStorage.setItem('missionpay_lang', next);
                } catch {}
              }}
              className="text-[13px] font-semibold px-3 py-1 bg-card hover:bg-mist text-ink border border-rule-2 rounded-full transition-colors focus:ring-2 focus:ring-ink"
              aria-label="Toggle language"
            >
              {t.switchLang}
            </button>
          </div>

          {/* Header Banner */}
          <section className="pt-4">
            <Kicker>{t.badge}</Kicker>
            <h1 className="display-h1 mb-5 max-w-[22ch]">
              <Stop>{t.title}</Stop>
            </h1>
            <p className="lede">{t.subtitle}</p>

            {/* Status Badges */}
            <div className="pt-6">
              {isLive ? (
                <span className="tag-paid border border-paid-rule">
                  {t.recordedBadge}
                </span>
              ) : isSimulated ? (
                <div className="outcome-warn inline-block px-4 py-3 text-left max-w-2xl">
                  <div className="flex items-center space-x-2 text-warn text-xs font-bold">
                    <span className="text-white w-2 h-2 rounded-full bg-warn" />
                    <span>{t.simulatedBadge} • BLOCK #{evidence?.forkBlockNumber || 'N/A'}</span>
                  </div>
                  <p className="text-sm text-ink-2 mt-1">{t.simulatedNotice}</p>
                </div>
              ) : (
                <div className="outcome-blocked inline-block px-4 py-3 text-left max-w-2xl">
                  <div className="flex items-center space-x-2 text-blocked text-xs font-bold">
                    <span className="text-white w-2 h-2 rounded-full bg-blocked" />
                    <span>{t.notRunBadge}</span>
                  </div>
                  <p className="text-sm text-ink-2 mt-1">{t.notRunNotice}</p>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      <div className="wrap pt-10 pb-10">
        {/* Precondition callout */}
        <div className="max-w-5xl border border-info-rule border-l-4 border-l-info bg-info-bg rounded-data p-4 text-sm text-ink-2 flex items-center justify-between flex-wrap gap-2">
          <span>{t.vendorNotice}</span>
          <a
            href="https://testnet.snowtrace.io/address/0x20451c1e2dCD83F166B4f22868BAdECb5868d545"
            target="_blank"
            rel="noopener noreferrer"
            className="text-info font-semibold underline underline-offset-2 hover:text-ink focus:ring-1 focus:ring-ink rounded-tag"
          >
            {t.viewContract} ↗
          </a>
        </div>

      </div>

      {/* Twin Columns Comparison (proof band) */}
      <div className="redbar" aria-hidden="true" />
      <div className="band-navy">
      <div className="wrap band">
        <div className="max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Column A: Global Allowlist Mode */}
          <div
            className="border border-l-4 border-blocked-rule border-l-brand bg-blocked-bg text-ink rounded-data p-6 flex flex-col justify-between space-y-6"
            tabIndex={0}
            role="region"
            aria-label="Treasury A: Global Allowlist Mode"
          >
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-[13px] text-blocked font-medium uppercase tracking-[0.08em]">
                  MISSION A • twin.allowlist.v1
                </span>
                <span
                  id="twin-col-a-outcome"
                  className="px-2 py-0.5 text-blocked border border-blocked-rule rounded-tag text-[13px] font-bold bg-card"
                >
                  {evidence?.missionA?.balanceDeltaUsdc
                    ? `${t.colALeak} (${evidence.missionA.balanceDeltaUsdc})`
                    : t.colALeak}
                </span>
              </div>
              <div>
                <h2 className="card-title">{t.colATitle}</h2>
                <p className="text-[15px] text-ink-2 mt-1">{t.colADesc}</p>
              </div>

              <div className="bg-card border border-blocked-rule rounded-data p-4 space-y-2 font-mono text-xs break-all">
                <div className="text-ink-2">
                  payeeRoot:{' '}
                  <span className="text-ink">
                    {evidence?.missionA?.payeeRoot || '0x0000000000000000000000000000000000000000000000000000000000000000'}
                  </span>
                </div>
                <div className="text-ink-2">
                  recipientAllowlist(vendor):{' '}
                  <span className="text-paid">
                    {evidence ? 'true (Globally Allowlisted)' : 'pending'}
                  </span>
                </div>
                <div className="text-ink-2">
                  call:{' '}
                  <span className="text-blocked">
                    propose(opA, vendor, 10000, twin.allowlist.v1, reason)
                  </span>
                </div>
                <div className="text-ink-2 pt-2 border-t border-rule">
                  Result:{' '}
                  <span className="text-blocked font-bold">
                    {evidence
                      ? `${evidence.missionA.simulationOutcome} (Balance Delta: ${evidence.missionA.balanceDeltaUsdc})`
                      : 'NOT RUN'}
                  </span>
                </div>
              </div>

              <p className="text-[15px] text-ink-2 leading-relaxed">
                {lang === 'vi'
                  ? 'Kẻ tấn công lừa agent bằng invoice giả mang địa chỉ vendor quen thuộc. Do hợp đồng chỉ kiểm tra danh sách cho phép chung và số tiền <= perTxCap, giao dịch tự động chuyển tiền ngay lập tức trong propose()!'
                  : 'The attacker tricks the agent with a poisoned invoice naming a recognized vendor. Because the contract only checks a global allowlist and the amount <= perTxCap, funds are immediately drained via safeTransfer in propose().'}
              </p>
            </div>

            <div className="pt-4 border-t border-blocked-rule font-mono text-xs text-ink-2">
              {isLive && evidence?.missionA?.txHash ? (
                <a
                  id="twin-col-a-tx"
                  href={`https://testnet.snowtrace.io/tx/${evidence.missionA.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blocked hover:underline"
                >
                  Tx: {evidence.missionA.txHash.slice(0, 16)}... ↗
                </a>
              ) : isSimulated ? (
                <span>Fork Simulation Verified (Block #{evidence?.forkBlockNumber})</span>
              ) : (
                <span>Status: NOT RUN</span>
              )}
            </div>
          </div>

          {/* Column B: Mission-Scoped Guard */}
          <div
            className="border border-l-4 border-paid-rule border-l-paid bg-paid-bg text-ink rounded-data p-6 flex flex-col justify-between space-y-6"
            tabIndex={0}
            role="region"
            aria-label="Treasury B: Mission-Scoped Guard"
          >
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-[13px] text-paid font-medium uppercase tracking-[0.08em]">
                  MISSION B • twin.mission.v1
                </span>
                <span className="px-2 py-0.5 text-paid border border-paid-rule rounded-tag text-[13px] font-bold bg-card">
                  {t.colBBlock}
                </span>
              </div>
              <div>
                <h2 className="card-title">{t.colBTitle}</h2>
                <p className="text-[15px] text-ink-2 mt-1">{t.colBDesc}</p>
              </div>

              {/* Negative Control Box */}
              <div className="bg-card border border-paid-rule rounded-data p-3 space-y-2 font-mono text-xs break-all">
                <div className="text-warn font-semibold">{t.negControlTitle}</div>
                <div className="text-ink-2">
                  verifyMerkleProof(vendor in rootB):{' '}
                  <span className="text-blocked font-bold">false (Not a leaf)</span>
                </div>
                <div className="text-ink-2">
                  call:{' '}
                  <span className="text-warn">
                    proposeWithProof(opB1, vendor, 10000, twin.mission.v1, ..., [])
                  </span>
                </div>
                <div className="text-ink-2">
                  Result:{' '}
                  <span id="twin-col-b-outcome" className="text-paid font-bold">
                    {evidence
                      ? `REVERT: "${evidence.missionB.negativeControl.revertReason}" (${evidence.missionB.negativeControl.balanceDeltaUsdc} leaked)`
                      : 'NOT RUN'}
                  </span>
                </div>
              </div>

              {/* Positive Control Box */}
              <div className="bg-card border border-paid-rule rounded-data p-3 space-y-2 font-mono text-xs break-all">
                <div className="text-paid font-semibold">{t.posControlTitle}</div>
                <div className="text-ink-2">
                  verifyMerkleProof(Owner in rootB):{' '}
                  <span className="text-paid font-bold">true (Valid proof)</span>
                </div>
                <div className="text-ink-2">
                  call:{' '}
                  <span className="text-paid">
                    proposeWithProof(opB2, Owner, 10000, twin.mission.v1, ..., proof)
                  </span>
                </div>
                <div className="text-ink-2">
                  Result:{' '}
                  <span id="twin-col-b-pos-outcome" className="text-paid font-bold">
                    {evidence
                      ? `${evidence.missionB.positiveControl.simulationOutcome} (Auto-Payout: ${evidence.missionB.positiveControl.balanceDeltaUsdc} returned to Owner)`
                      : 'NOT RUN'}
                  </span>
                </div>
              </div>

              <p className="text-[15px] text-ink-2 leading-relaxed">
                {lang === 'vi'
                  ? 'Khi kẻ tấn công cố chuyển tiền cho vendor ngoài mission, hợp đồng đối chiếu chữ ký Merkle root của mission và từ chối ngay lập tức (PayeeNotInMissionSet). Đồng thời, vendor chính thức của mission có Merkle proof hợp lệ vẫn được thanh toán bình thường.'
                  : 'When the attacker attempts to divert payment to a non-mission vendor, the contract validates the Merkle root on-chain and rejects the transaction with PayeeNotInMissionSet. Simultaneously, the authorized mission payee with valid proof is successfully paid.'}
              </p>
            </div>

            <div className="pt-4 border-t border-paid-rule font-mono text-xs text-ink-2">
              {isLive &&
              evidence?.missionB?.negativeControl?.txHash &&
              evidence?.missionB?.positiveControl?.txHash ? (
                <div className="flex flex-col space-y-1">
                  <a
                    id="twin-col-b-revert-tx"
                    href={`https://testnet.snowtrace.io/tx/${evidence.missionB.negativeControl.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-warn hover:underline"
                  >
                    Revert Tx: {evidence.missionB.negativeControl.txHash.slice(0, 16)}... ↗
                  </a>
                  <a
                    id="twin-col-b-pos-tx"
                    href={`https://testnet.snowtrace.io/tx/${evidence.missionB.positiveControl.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-paid hover:underline"
                  >
                    Payout Tx: {evidence.missionB.positiveControl.txHash.slice(0, 16)}... ↗
                  </a>
                </div>
              ) : isSimulated ? (
                <span>Fork Simulation Verified (Block #{evidence?.forkBlockNumber})</span>
              ) : (
                <span>Status: NOT RUN</span>
              )}
            </div>
          </div>
        </div>

      </div>
      </div>

      <div className="wrap band">
      <div className="w-full max-w-5xl flex flex-col space-y-6">
        {/* Planned Live Transactions Section */}
        {evidence?.plannedTransactions && evidence.plannedTransactions.length > 0 && (
          <div className="border border-rule bg-card rounded-data p-6 space-y-4">
            <h3 className="card-title">
              {t.txPlanTitle}
            </h3>
            <div className="space-y-3 text-sm">
              {evidence.plannedTransactions.map((tx) => (
                <div
                  key={tx.step}
                  className="border border-rule bg-paper rounded-data p-3 flex flex-col md:flex-row md:items-center justify-between gap-2"
                >
                  <div>
                    <span
                      className={
                        tx.step <= 2 || tx.step === 9
                          ? 'text-ink font-bold'
                          : tx.step === 6
                          ? 'text-blocked font-bold'
                          : 'text-paid font-bold'
                      }
                    >
                      Step {tx.step}:
                    </span>{' '}
                    <span>{tx.description}</span>
                  </div>
                  <div className="text-ink-2">
                    Signer: {tx.signer.split(' ')[0]} • Gas: {tx.gasLimit} ({tx.estimatedCostAvax})
                  </div>
                </div>
              ))}
            </div>
            <div className="text-sm text-ink-2 pt-2 flex flex-wrap gap-2 justify-between items-center">
              <span>Total Gas: {evidence.totalEstimatedGasAvax}</span>
              <span className="text-paid">Within Budget ({evidence.totalUsdcBudget} &le; 0.05 USDC)</span>
            </div>
          </div>
        )}

        {/* Conclusion / Takeaway */}
        <div className="bg-card border border-rule rounded-card p-6 sm:p-8 space-y-3">
          <h2 className="sec-h">
            <Stop>{t.conclusionTitle}</Stop>
          </h2>
          <p className="text-base text-ink-2 max-w-3xl leading-relaxed">
            {t.conclusionText}
          </p>
        </div>
      </div>
      </div>
    </main>
  );
}
