'use client';

import { Kicker, Stop } from '@/components/Display';

export default function QueuePage() {
  return (
    <div>
    <div className="hero-band hero-sand">
      <div className="hero-inner">
        <Kicker>Owner supervision</Kicker>
        <h1 className="display-h1 mb-5 max-w-[20ch]"><Stop>Treasury Human Queue (Stage S2)</Stop></h1>
        <p className="lede">
          Owner supervision interface for proposals that exceeded auto-execution soft caps.
        </p>
        <div className="pt-6">
          <span className="tag-warn border border-warn-rule font-mono">
            Stage: S2 Cutover Required
          </span>
        </div>
      </div>
    </div>
    <div className="wrap band space-y-6">

      <div className="card p-6 space-y-4">
        <h2 className="card-title">Stage S2 Queue Architecture</h2>
        <p className="text-base text-ink-2 leading-relaxed">
          In Stage S2, when an agent proposes a treasury payout that exceeds the per-transaction cap
          (5 USDC), UTC daily cap (20 USDC), or mission treasury cap (10 USDC), the GuardedTreasury
          contract queues the proposal on-chain with a 48-hour expiration TTL.
        </p>

        <div className="p-4 bg-chalk rounded-data border border-rule text-[13px] font-mono space-y-2 text-ink-2">
          <div>// Two-transaction Owner Approval &amp; Execution Pattern (01 §6, 06 C8)</div>
          <div>1. Owner MetaMask tx: GuardedTreasury.approve(proposalId) → status = Approved</div>
          <div>2. Owner MetaMask tx: GuardedTreasury.execute(proposalId) → status = Executed (funds transferred)</div>
          <div>3. Hard checks (pause, allowlist, mission active) re-evaluated at execute() time</div>
        </div>

        <div className="outcome-warn text-sm text-ink-2 pt-3">
          Notice: In Stage S1, all tool purchases execute directly off-chain via agent EIP-3009 reservations.
          The on-chain GuardedTreasury contract source and tests are ready in contracts/ for S2 deployment.
        </div>
      </div>
    </div>
    </div>
  );
}
