'use client';

export default function QueuePage() {
  return (
    <div className="wrap space-y-6 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Treasury Human Queue (Stage S2)</h1>
          <p className="text-ink-2 text-sm">
            Owner supervision interface for proposals that exceeded auto-execution soft caps.
          </p>
        </div>
        <span className="bg-tint-slate text-ink border border-rule-2 text-xs px-2.5 py-1 rounded font-mono">
          Stage: S2 Cutover Required
        </span>
      </div>

      <div className="bg-paper border border-rule rounded-lg p-6 space-y-4">
        <h2 className="font-semibold text-ink">Stage S2 Queue Architecture</h2>
        <p className="text-sm text-ink-2 leading-relaxed">
          In Stage S2, when an agent proposes a treasury payout that exceeds the per-transaction cap
          (5 USDC), UTC daily cap (20 USDC), or mission treasury cap (10 USDC), the GuardedTreasury
          contract queues the proposal on-chain with a 48-hour expiration TTL.
        </p>

        <div className="p-4 bg-card rounded border border-rule text-xs font-mono space-y-2 text-ink-2">
          <div>// Two-transaction Owner Approval &amp; Execution Pattern (01 §6, 06 C8)</div>
          <div>1. Owner MetaMask tx: GuardedTreasury.approve(proposalId) → status = Approved</div>
          <div>2. Owner MetaMask tx: GuardedTreasury.execute(proposalId) → status = Executed (funds transferred)</div>
          <div>3. Hard checks (pause, allowlist, mission active) re-evaluated at execute() time</div>
        </div>

        <div className="text-sm text-ink-3 italic pt-2">
          Notice: In Stage S1, all tool purchases execute directly off-chain via agent EIP-3009 reservations.
          The on-chain GuardedTreasury contract source and tests are ready in contracts/ for S2 deployment.
        </div>
      </div>
    </div>
  );
}
