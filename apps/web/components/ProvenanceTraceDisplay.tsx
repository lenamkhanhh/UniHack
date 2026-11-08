'use client';

import React from 'react';
import { ProvenanceTrace } from '@/lib/provenance-trace';

interface Props {
  trace: ProvenanceTrace;
}

export default function ProvenanceTraceDisplay({ trace }: Props) {
  return (
    <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2">
          <span className="text-base">🧬</span>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
            Đường Đi Dữ Liệu Bẩn (Provenance Trace)
          </span>
        </div>
        <span
          className={`text-[10px] font-bold px-2.5 py-0.5 rounded border ${
            trace.isBlocked
              ? 'bg-red-950/80 text-red-400 border-red-800/70'
              : 'bg-emerald-950/80 text-emerald-400 border-emerald-800/70'
          }`}
        >
          {trace.isBlocked ? 'ĐÃ CHẶN NGUỒN GỐC BẨN' : 'NGUỒN GỐC AN TOÀN'}
        </span>
      </div>

      <p className="text-xs text-slate-400 font-mono bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/60">
        {trace.summary}
      </p>

      {/* Visual Step-by-Step Flow */}
      <div className="relative pl-6 space-y-4 border-l-2 border-slate-800 ml-3">
        {trace.steps.map((st) => {
          let badgeColor = 'bg-slate-800 text-slate-300 border-slate-700';
          let dotColor = 'bg-slate-500';

          if (st.status === 'TAINTED') {
            badgeColor = 'bg-amber-950/80 text-amber-300 border-amber-800/70';
            dotColor = 'bg-amber-400';
          } else if (st.status === 'BLOCKED') {
            badgeColor = 'bg-red-950/80 text-red-300 border-red-800/70';
            dotColor = 'bg-red-500';
          } else if (st.status === 'REVERTED') {
            badgeColor = 'bg-emerald-950/80 text-emerald-300 border-emerald-800/70';
            dotColor = 'bg-emerald-400';
          } else if (st.status === 'SAFE') {
            badgeColor = 'bg-emerald-950/60 text-emerald-300 border-emerald-800/50';
            dotColor = 'bg-emerald-500';
          }

          return (
            <div key={st.step} className="relative group">
              {/* Dot on the timeline */}
              <div
                className={`absolute -left-[31px] top-1.5 w-3.5 h-3.5 rounded-full border-2 border-slate-950 ${dotColor} transition-transform group-hover:scale-125`}
              />

              <div className="bg-slate-900/70 border border-slate-800/80 rounded-lg p-3 space-y-1 hover:border-slate-700 transition">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-200">
                    Bước {st.step}: {st.label}
                  </span>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${badgeColor}`}>
                    {st.status}
                  </span>
                </div>
                <div className="text-[11px] font-mono text-slate-400">{st.source}</div>
                <div className="text-xs text-slate-300">{st.detail}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
