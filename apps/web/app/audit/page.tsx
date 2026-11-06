'use client';

import { useState, useEffect } from 'react';

export default function AuditPage() {
  const [entries, setEntries] = useState<any[]>([]);
  const [checkpoint, setCheckpoint] = useState<{ headHash: string; entryCount: number } | null>(null);
  const [verificationResult, setVerificationResult] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/audit')
      .then((res) => res.json())
      .then((data) => {
        setEntries(data.entries || []);
        setCheckpoint(data.checkpoint || null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleVerify = async () => {
    try {
      const res = await fetch('/api/audit/verify');
      const data = await res.json();
      setVerificationResult(data);
    } catch (err: any) {
      setVerificationResult({ valid: false, errors: [err.message] });
    }
  };

  const handleExport = () => {
    const dataStr =
      'data:text/json;charset=utf-8,' +
      encodeURIComponent(JSON.stringify({ checkpoint, entries }, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `audit-checkpoint-${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Canonical Audit Ledger</h1>
          <p className="text-slate-400 text-sm">
            Serialized append-only cryptographic hash chain of all decisions and settlements.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleVerify}
            className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-3 py-1.5 rounded transition"
          >
            Verify Chain
          </button>
          <button
            onClick={handleExport}
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold px-3 py-1.5 rounded border border-slate-700 transition"
          >
            Export Proof JSON
          </button>
        </div>
      </div>

      {checkpoint && (
        <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 font-mono text-xs space-y-1">
          <div className="text-slate-400 font-semibold">Current Checkpoint:</div>
          <div className="text-slate-300">Head Hash: {checkpoint.headHash}</div>
          <div className="text-slate-300">Total Entries: {checkpoint.entryCount}</div>
        </div>
      )}

      {verificationResult && (
        <div
          className={`p-4 rounded border text-sm font-mono ${
            verificationResult.valid
              ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
              : 'bg-rose-950/60 border-rose-800 text-rose-300'
          }`}
        >
          {verificationResult.valid ? (
            <div>PASS: All {verificationResult.totalEntries} entries verified. Head hash matches.</div>
          ) : (
            <div>
              <div className="font-bold">FAIL: Verification failed:</div>
              <ul className="list-disc pl-5 mt-1 space-y-0.5">
                {verificationResult.errors?.map((err: string, i: number) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="bg-slate-950 border border-slate-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-900 border-b border-slate-800 text-slate-400">
              <tr>
                <th className="p-3">#</th>
                <th className="p-3">Kind</th>
                <th className="p-3">Source Key</th>
                <th className="p-3">Entry Hash</th>
                <th className="p-3">Prev Hash</th>
                <th className="p-3">Created At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-500">
                    Loading audit entries...
                  </td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-500">
                    No audit entries logged yet.
                  </td>
                </tr>
              ) : (
                entries.map((entry) => (
                  <tr key={entry.sourceKey} className="hover:bg-slate-900/40">
                    <td className="p-3 text-slate-500">{entry.id}</td>
                    <td className="p-3 font-semibold text-emerald-400">
                      {JSON.parse(entry.canonicalJson).kind}
                    </td>
                    <td className="p-3 text-slate-300">{entry.sourceKey}</td>
                    <td className="p-3 text-slate-400 truncate max-w-[140px]">{entry.entryHash}</td>
                    <td className="p-3 text-slate-500 truncate max-w-[140px]">{entry.prevHash}</td>
                    <td className="p-3 text-slate-500">{new Date(entry.createdAt).toLocaleTimeString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
