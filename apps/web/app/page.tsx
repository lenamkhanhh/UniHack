'use client';

import { useState, useEffect } from 'react';

export default function DashboardPage() {
  const [missions, setMissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/missions')
      .then((res) => res.json())
      .then((data) => {
        setMissions(data.missions || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Mission Dashboard</h1>
          <p className="text-slate-400 text-sm">
            Overview of active missions, two separate budgets, and deliverable results.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="bg-emerald-950 text-emerald-400 border border-emerald-800 text-xs px-2.5 py-1 rounded font-mono">
            Avalanche Fuji (43113)
          </span>
          <span className="bg-amber-950 text-amber-400 border border-amber-800 text-xs px-2.5 py-1 rounded font-mono">
            Payment Mode: MOCK
          </span>
        </div>
      </div>

      {loading ? (
        <div className="text-slate-400 py-12 text-center">Loading missions...</div>
      ) : missions.length === 0 ? (
        <div className="bg-slate-950 border border-slate-800 rounded-lg p-8 text-center space-y-4">
          <p className="text-slate-400">No missions found in current database deployment.</p>
          <a
            href="/demo"
            className="inline-block bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-4 py-2 rounded text-sm transition"
          >
            Go to Demo & Run Test Mission
          </a>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {missions.map((m) => {
            const toolCap = BigInt(m.toolCap || '0');
            const spentTool = BigInt(m.spentTool || '0');
            const reservedTool = BigInt(m.reservedTool || '0');
            const toolRemaining = toolCap - spentTool - reservedTool;

            const treasuryCap = BigInt(m.treasuryCap || '0');
            const spentTreasury = BigInt(m.spentTreasury || '0');
            const treasuryRemaining = treasuryCap > spentTreasury ? treasuryCap - spentTreasury : 0n;
            const treasuryOverBy = spentTreasury > treasuryCap ? spentTreasury - treasuryCap : 0n;

            return (
              <div
                key={m.slug}
                className="bg-slate-950 border border-slate-800 rounded-lg p-6 space-y-4 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm font-bold text-emerald-400">
                    {m.slug}
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded font-semibold ${
                      m.status === 'ACTIVE'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-rose-500/20 text-rose-300'
                    }`}
                  >
                    {m.status}
                  </span>
                </div>

                <div className="text-xs font-mono space-y-1 text-slate-400">
                  <div>Owner: {m.ownerAddress}</div>
                  <div>Agent: {m.agentAddress}</div>
                  <div>Expires: {new Date(m.expiresAt).toLocaleString()}</div>
                </div>

                {/* Two Separate Budgets (00 §2, 05 §5) */}
                <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-900">
                  <div className="bg-slate-900/60 p-3 rounded border border-slate-800/80">
                    <div className="text-xs text-slate-400 font-medium">Tool Budget (S1)</div>
                    <div className="text-lg font-bold font-mono text-slate-200 mt-1">
                      {(Number(toolRemaining) / 1e6).toFixed(2)} USDC
                    </div>
                    <div className="text-xs text-slate-500 mt-1 space-y-0.5">
                      <div>Spent: {(Number(spentTool) / 1e6).toFixed(2)}</div>
                      <div>Reserved: {(Number(reservedTool) / 1e6).toFixed(2)}</div>
                      <div>Cap: {(Number(toolCap) / 1e6).toFixed(2)}</div>
                    </div>
                  </div>

                  <div className="bg-slate-900/60 p-3 rounded border border-slate-800/80">
                    <div className="text-xs text-slate-400 font-medium">Treasury Budget (S2)</div>
                    <div className="text-lg font-bold font-mono text-slate-200 mt-1">
                      {(Number(treasuryRemaining) / 1e6).toFixed(2)} USDC
                    </div>
                    <div className="text-xs text-slate-500 mt-1 space-y-0.5">
                      <div>Cap: {(Number(treasuryCap) / 1e6).toFixed(2)}</div>
                      {treasuryOverBy > 0n && (
                        <div className="text-amber-400">
                          Over by: {(Number(treasuryOverBy) / 1e6).toFixed(2)}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {m.deliverableHash && (
                  <div className="text-xs bg-emerald-950/40 border border-emerald-900/50 p-2.5 rounded font-mono text-emerald-300">
                    Deliverable Hash: {m.deliverableHash}
                  </div>
                )}

                <div className="pt-2 flex items-center justify-between text-xs">
                  <a
                    href={`/api/missions/${m.slug}/proof`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-400 hover:underline font-mono"
                  >
                    View Mission Proof &rarr;
                  </a>
                  {new Date() >= new Date(m.expiresAt) && (
                    <span className="text-slate-400 italic">
                      Mission expired — Read recovery available
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
