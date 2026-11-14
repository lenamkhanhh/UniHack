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
    <div>
    <div className="hero-band hero-mint">
      <div className="hero-inner flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="display-h1 mb-5 stop-after">Canonical Audit Ledger</h1>
          <p className="lede">
            Serialized append-only cryptographic hash chain of all decisions and settlements.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleVerify}
            className="btn-dark btn-sm whitespace-nowrap"
          >
            Verify Chain
          </button>
          <button
            onClick={handleExport}
            className="btn-ghost btn-sm whitespace-nowrap"
          >
            Export Proof JSON
          </button>
        </div>
      </div>
    </div>
    <div className="wrap band space-y-6">

      {checkpoint && (
        <div className="bg-paper border border-rule rounded-data p-4 text-xs space-y-1">
          <div className="text-ink-2 font-semibold">Current Checkpoint:</div>
          <div className="text-ink-2">Head Hash: {checkpoint.headHash}</div>
          <div className="text-ink-2">Total Entries: {checkpoint.entryCount}</div>
        </div>
      )}

      {verificationResult && (
        <div
          className={`p-4 rounded-tag border text-sm ${
            verificationResult.valid
              ? 'bg-paid-bg border-paid-rule text-paid'
              : 'bg-blocked-bg border-blocked-rule text-blocked'
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

      <div className="bg-paper border border-rule rounded-data overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-card border-b border-rule text-ink-2">
              <tr>
                <th className="p-3">#</th>
                <th className="p-3">Kind</th>
                <th className="p-3">Source Key</th>
                <th className="p-3">Entry Hash</th>
                <th className="p-3">Prev Hash</th>
                <th className="p-3">Created At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {loading ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-ink-3">
                    Loading audit entries...
                  </td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-ink-3">
                    No audit entries logged yet.
                  </td>
                </tr>
              ) : (
                entries.map((entry) => (
                  <tr key={entry.sourceKey} className="hover:bg-card">
                    <td className="p-3 text-ink-3">{entry.id}</td>
                    <td className="p-3 font-semibold text-paid">
                      {JSON.parse(entry.canonicalJson).kind}
                    </td>
                    <td className="p-3 text-ink-2">{entry.sourceKey}</td>
                    <td className="p-3 text-ink-2 truncate max-w-[140px]">{entry.entryHash}</td>
                    <td className="p-3 text-ink-3 truncate max-w-[140px]">{entry.prevHash}</td>
                    <td className="p-3 text-ink-3">{new Date(entry.createdAt).toLocaleTimeString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    </div>
  );
}
