'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';

interface MissionSummary {
  slug: string;
  status: string;
  ownerAddress: string;
  agentAddress: string;
  expiresAt: string;
  payeeRoot?: string;
  payeeRootConfirmedOnchain?: boolean;
  toolCap?: string;
  spentTool?: string;
  reservedTool?: string;
  treasuryCap?: string;
  spentTreasury?: string;
  deliverableHash?: string;
}

export default function LandingPage() {
  const { t } = useI18n();
  const [missions, setMissions] = useState<MissionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMissions = () => {
    setLoading(true);
    setError(null);
    fetch('/api/missions')
      .then((res) => {
        if (!res.ok) throw new Error('Network response was not ok');
        return res.json();
      })
      .then((data) => {
        setMissions(data.missions || []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || 'Failed to load missions');
        setLoading(false);
      });
  };

  useEffect(() => {
    loadMissions();
  }, []);

  return (
    <div className="space-y-12 py-4">
      {/* Hero Section with Exact Positioning Sentence */}
      <section aria-labelledby="hero-heading" className="text-center space-y-6 pt-4 pb-8 border-b border-slate-800/80">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-950/80 border border-emerald-700/60 text-emerald-300 text-xs font-mono font-semibold">
          <span className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          Avalanche Fuji (43113) · Defense in Depth
        </div>

        <h1
          id="hero-heading"
          className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-black tracking-tight text-white max-w-4xl mx-auto leading-tight"
        >
          {t('landing.hero.title')}
        </h1>

        <p className="text-slate-300 text-sm sm:text-base md:text-lg max-w-2xl mx-auto leading-relaxed">
          {t('landing.hero.subtitle')}
        </p>

        {/* 3 Primary CTA Buttons */}
        <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
          <Link
            href="/bounty"
            className="px-6 py-3 rounded-xl font-bold text-sm bg-gradient-to-r from-red-600 to-amber-500 hover:from-red-500 hover:to-amber-400 text-white shadow-lg shadow-red-900/30 transition transform hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-amber-400 min-h-[44px] flex items-center justify-center gap-2"
          >
            <span>🎯</span>
            <span>{t('landing.btn.bounty')}</span>
          </Link>

          <Link
            href="/verify/demo-seed"
            className="px-6 py-3 rounded-xl font-bold text-sm bg-slate-900 hover:bg-slate-800 text-emerald-300 border border-emerald-500/50 hover:border-emerald-400 shadow-lg shadow-emerald-950/40 transition transform hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-emerald-400 min-h-[44px] flex items-center justify-center gap-2"
          >
            <span>🔍</span>
            <span>{t('landing.btn.verify')}</span>
          </Link>

          <Link
            href="/missions/new"
            className="px-6 py-3 rounded-xl font-bold text-sm bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/40 transition transform hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-indigo-400 min-h-[44px] flex items-center justify-center gap-2"
          >
            <span>🔑</span>
            <span>{t('landing.btn.passkey')}</span>
          </Link>
        </div>
      </section>

      {/* 3-Pillar Security Architecture Cards */}
      <section aria-label="Security Architecture" className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800 space-y-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-xl">
            🧠
          </div>
          <h2 className="text-base font-bold text-white">{t('landing.card.planner_title')}</h2>
          <p className="text-xs text-slate-300 leading-relaxed">
            {t('landing.card.planner_desc')}
          </p>
        </div>

        <div className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800 space-y-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-xl">
            🛡️
          </div>
          <h2 className="text-base font-bold text-white">{t('landing.card.guard_title')}</h2>
          <p className="text-xs text-slate-300 leading-relaxed">
            {t('landing.card.guard_desc')}
          </p>
        </div>

        <div className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800 space-y-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-xl">
            ⛓️
          </div>
          <h2 className="text-base font-bold text-white">{t('landing.card.chain_title')}</h2>
          <p className="text-xs text-slate-300 leading-relaxed">
            {t('landing.card.chain_desc')}
          </p>
        </div>
      </section>

      {/* Active Missions Dashboard Section */}
      <section aria-labelledby="active-missions-heading" className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-4">
          <div>
            <h2 id="active-missions-heading" className="text-xl sm:text-2xl font-bold text-white">
              {t('landing.section.missions')}
            </h2>
            <p className="text-slate-400 text-xs sm:text-sm mt-0.5">
              {t('landing.section.missions_desc')}
            </p>
          </div>
          <button
            onClick={loadMissions}
            className="self-start sm:self-auto px-3 py-1.5 text-xs font-semibold rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition focus:outline-none focus:ring-2 focus:ring-emerald-400"
            aria-label="Refresh mission list"
          >
            ↻ Refresh
          </button>
        </div>

        {loading ? (
          <div className="py-16 text-center space-y-3" role="status" aria-live="polite">
            <div className="w-8 h-8 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin mx-auto"></div>
            <p className="text-slate-400 text-sm">{t('landing.loading')}</p>
          </div>
        ) : error ? (
          <div className="bg-red-950/30 border border-red-500/40 rounded-xl p-6 text-center space-y-3">
            <p className="text-red-300 text-sm font-semibold">Error: {error}</p>
            <button
              onClick={loadMissions}
              className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-bold transition focus:outline-none focus:ring-2 focus:ring-red-400"
            >
              Retry Connection
            </button>
          </div>
        ) : missions.length === 0 ? (
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-8 text-center space-y-4">
            <p className="text-slate-300 text-sm">{t('landing.empty.title')}</p>
            <p className="text-slate-400 text-xs">{t('landing.empty.desc')}</p>
            <div className="flex flex-wrap justify-center gap-3 pt-2">
              <Link
                href="/demo"
                className="inline-block bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-4 py-2 rounded-lg text-xs transition focus:outline-none focus:ring-2 focus:ring-emerald-400 min-h-[40px] flex items-center"
              >
                {t('landing.btn.demo')}
              </Link>
              <Link
                href="/bounty"
                className="inline-block bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold px-4 py-2 rounded-lg text-xs transition border border-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400 min-h-[40px] flex items-center"
              >
                {t('landing.btn.bounty_cta')}
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            {missions.map((m) => {
              const toolCap = BigInt(m.toolCap || '0');
              const spentTool = BigInt(m.spentTool || '0');
              const reservedTool = BigInt(m.reservedTool || '0');
              const toolRemaining = toolCap > spentTool + reservedTool ? toolCap - spentTool - reservedTool : 0n;

              const treasuryCap = BigInt(m.treasuryCap || '0');
              const spentTreasury = BigInt(m.spentTreasury || '0');
              const treasuryRemaining = treasuryCap > spentTreasury ? treasuryCap - spentTreasury : 0n;
              const treasuryOverBy = spentTreasury > treasuryCap ? spentTreasury - treasuryCap : 0n;

              return (
                <div
                  key={m.slug}
                  className="bg-slate-950 border border-slate-800/90 rounded-2xl p-6 space-y-4 shadow-sm hover:border-slate-700 transition"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-bold text-emerald-400 truncate max-w-[200px] sm:max-w-xs">
                      {m.slug}
                    </span>
                    <span
                      className={`text-xs px-2.5 py-0.5 rounded font-semibold ${
                        m.status === 'ACTIVE'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                      }`}
                    >
                      {m.status}
                    </span>
                  </div>

                  <div className="text-xs font-mono space-y-1 text-slate-300">
                    <div className="truncate">Owner: {m.ownerAddress}</div>
                    <div className="truncate">Agent: {m.agentAddress}</div>
                    <div>Expires: {new Date(m.expiresAt).toLocaleString()}</div>
                    {m.payeeRoot && (
                      <div className="pt-1">
                        {m.payeeRootConfirmedOnchain ? (
                          <span
                            data-testid="payee-root-onchain-badge"
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-700/80"
                          >
                            {t('landing.card.payee_root_onchain')}: {m.payeeRoot.slice(0, 10)}...{m.payeeRoot.slice(-6)}
                          </span>
                        ) : (
                          <span
                            data-testid="payee-root-unconfirmed-badge"
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-amber-950/80 text-amber-300 border border-amber-700/80"
                          >
                            {t('landing.card.payee_root_pending')}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Two Separate Budgets */}
                  <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-900">
                    <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                      <div className="text-xs text-slate-300 font-medium">{t('landing.card.tool_budget')}</div>
                      <div className="text-lg font-bold font-mono text-slate-100 mt-1">
                        {(Number(toolRemaining) / 1e6).toFixed(2)} USDC
                      </div>
                      <div className="text-xs text-slate-400 mt-1 space-y-0.5">
                        <div>{t('landing.card.spent')}: {(Number(spentTool) / 1e6).toFixed(2)}</div>
                        <div>{t('landing.card.reserved')}: {(Number(reservedTool) / 1e6).toFixed(2)}</div>
                        <div>{t('landing.card.cap')}: {(Number(toolCap) / 1e6).toFixed(2)}</div>
                      </div>
                    </div>

                    <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                      <div className="text-xs text-slate-300 font-medium">{t('landing.card.treasury_budget')}</div>
                      <div className="text-lg font-bold font-mono text-slate-100 mt-1">
                        {(Number(treasuryRemaining) / 1e6).toFixed(2)} USDC
                      </div>
                      <div className="text-xs text-slate-400 mt-1 space-y-0.5">
                        <div>{t('landing.card.cap')}: {(Number(treasuryCap) / 1e6).toFixed(2)}</div>
                        {treasuryOverBy > 0n && (
                          <div className="text-amber-400">
                            {t('landing.card.over_by')}: {(Number(treasuryOverBy) / 1e6).toFixed(2)}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {m.deliverableHash && (
                    <div className="text-xs bg-emerald-950/40 border border-emerald-900/50 p-2.5 rounded-lg font-mono text-emerald-300 break-all">
                      Deliverable Hash: {m.deliverableHash}
                    </div>
                  )}

                  <div className="pt-2 flex items-center justify-between text-xs">
                    <Link
                      href={`/verify/${m.slug}`}
                      className="text-emerald-400 hover:underline font-mono focus:outline-none focus:ring-1 focus:ring-emerald-400 rounded"
                    >
                      {t('landing.card.view_proof')}
                    </Link>
                    {new Date() >= new Date(m.expiresAt) && (
                      <span className="text-slate-400 italic">
                        {t('landing.card.expired')}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
