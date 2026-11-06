'use client';

export default function QueuePage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Treasury Human Queue (Stage S2)</h1>
          <p className="text-slate-400 text-sm">
            Owner supervision interface for proposals that exceeded auto-execution soft caps.
          </p>
        </div>
        <span className="bg-blue-950 text-blue-400 border border-blue-800 text-xs px-2.5 py-1 rounded font-mono">
          Stage: S2 Cutover Required
        </span>
      </div>

      <div className="bg-slate-950 border border-slate-800 rounded-lg p-6 space-y-4">
        <h2 className="font-semibold text-slate-200">Stage S2 Queue Architecture</h2>
        <p className="text-sm text-slate-400 leading-relaxed">
          In Stage S2, when an agent proposes a treasury payout that exceeds the per-transaction cap
          (5 USDC), UTC daily cap (20 USDC), or mission treasury cap (10 USDC), the GuardedTreasury
          contract queues the proposal on-chain with a 48-hour expiration TTL.
        </p>

        <div className="p-4 bg-slate-900 rounded border border-slate-800 text-xs font-mono space-y-2 text-slate-300">
          <div>// Two-transaction Owner Approval &amp; Execution Pattern (01 §6, 06 C8)</div>
          <div>1. Owner MetaMask tx: GuardedTreasury.approve(proposalId) → status = Approved</div>
          <div>2. Owner MetaMask tx: GuardedTreasury.execute(proposalId) → status = Executed (funds transferred)</div>
          <div>3. Hard checks (pause, allowlist, mission active) re-evaluated at execute() time</div>
        </div>

        <div className="text-sm text-slate-500 italic pt-2">
          Notice: In Stage S1, all tool purchases execute directly off-chain via agent EIP-3009 reservations.
          The on-chain GuardedTreasury contract source and tests are ready in contracts/ for S2 deployment.
        </div>
      </div>
    </div>
  );
}
