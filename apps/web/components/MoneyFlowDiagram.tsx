'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { DEMO_SEED_MONEY_FLOW_ENTRIES, SeedLedgerEntry } from '@/lib/demo-seeds';

interface MoneyFlowProps {
  mode?: 'LIVE' | 'DEMO SEED' | 'MOCK';
  missionSlug?: string;
  autoSimulate?: boolean;
}

interface ParsedEntry {
  id: string;
  from: string;
  to: string;
  amount: string;
  status: 'SETTLED' | 'BLOCKED';
  rule?: string;
  txHash: string;
}

export default function MoneyFlowDiagram({ mode = 'DEMO SEED', missionSlug, autoSimulate = false }: MoneyFlowProps) {
  const [animationState, setAnimationState] = useState<'IDLE' | 'FLOWING_VALID' | 'FLOWING_BLOCKED' | 'BOUNCED'>('IDLE');
  const [blockedRule, setBlockedRule] = useState<string>('RECIPIENT_NOT_ALLOWLISTED');
  const [realEntries, setRealEntries] = useState<ParsedEntry[]>([]);
  const [paymentMode, setPaymentMode] = useState<string>('MOCK');
  const [loading, setLoading] = useState(false);

  // Fetch real audit entries and system policy when not in DEMO SEED
  useEffect(() => {
    if (mode === 'DEMO SEED') {
      return;
    }

    let isMounted = true;
    const fetchData = async () => {
      setLoading(true);
      try {
        const [policyRes, auditRes] = await Promise.all([
          fetch('/api/policy').then((r) => r.json()),
          fetch(missionSlug ? `/api/audit?missionSlug=${missionSlug}` : '/api/audit?feed=1').then((r) => r.json()),
        ]);

        if (isMounted) {
          setPaymentMode(policyRes?.paymentMode || 'MOCK');
          if (Array.isArray(auditRes?.entries)) {
            const parsed: ParsedEntry[] = auditRes.entries.map((e: any, idx: number) => {
              let parsedJson: any = {};
              try {
                parsedJson = JSON.parse(e.canonicalJson || '{}');
              } catch {
                parsedJson = {};
              }

              const isBlocked = parsedJson.kind === 'ATTACK_BLOCKED' || parsedJson.status === 'BLOCK' || parsedJson.rule?.includes('NOT_ALLOWLISTED');
              const amountAtomic = parsedJson.amount || parsedJson.amount_atomic || '0';
              const amountUsdc = (Number(amountAtomic) / 1_000_000).toFixed(2);

              return {
                id: e.id || `entry-${idx}`,
                from: parsedJson.actor || 'Session #1',
                to: parsedJson.to || (isBlocked ? '0xA77AC... (Attacker)' : 'Merchant Tool'),
                amount: `${amountUsdc} USDC`,
                status: isBlocked ? 'BLOCKED' : 'SETTLED',
                rule: parsedJson.rule,
                txHash: parsedJson.tx_hash || e.txHash || '',
              };
            });
            setRealEntries(parsed);
          } else {
            setRealEntries([]);
          }
        }
      } catch {
        if (isMounted) setRealEntries([]);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 4000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [mode, missionSlug]);

  // Determine active entries strictly according to mode
  const activeEntries: ParsedEntry[] = useMemo(() => {
    if (mode === 'DEMO SEED') {
      return DEMO_SEED_MONEY_FLOW_ENTRIES;
    }
    return realEntries;
  }, [mode, realEntries]);

  // Label strictly follows honesty rule (F1)
  const isLiveHonest = useMemo(() => {
    if (mode === 'DEMO SEED') return false;
    const hasVerifiedFujiTx = activeEntries.some((e) => e.txHash && e.txHash.startsWith('0x') && e.txHash.length === 66);
    return paymentMode === 'LIVE_FUJI' && hasVerifiedFujiTx;
  }, [mode, paymentMode, activeEntries]);

  const triggerValidFlow = () => {
    setAnimationState('FLOWING_VALID');
    setTimeout(() => {
      setAnimationState('IDLE');
    }, 1500);
  };

  const triggerBlockedFlow = () => {
    setAnimationState('FLOWING_BLOCKED');
    setBlockedRule('RECIPIENT_NOT_ALLOWLISTED');
    setTimeout(() => {
      setAnimationState('BOUNCED');
      setTimeout(() => {
        setAnimationState('IDLE');
      }, 2000);
    }, 800);
  };

  useEffect(() => {
    if (autoSimulate) {
      const timer = setTimeout(() => {
        triggerBlockedFlow();
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [autoSimulate]);

  return (
    <div className="w-full bg-night border border-night-rule rounded-2xl p-6 font-mono text-white flex flex-col justify-between">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-night-rule pb-3 mb-6 gap-2">
        <div className="flex items-center space-x-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
          <h3 className="text-sm font-bold tracking-wide text-white uppercase">
            LIVING MONEY FLOW — LIÊN KẾT AUDIT LEDGER
          </h3>
        </div>
        <div className="flex items-center space-x-2">
          {mode === 'DEMO SEED' ? (
            <span className="text-[13px] bg-amber-500/20 text-amber-300 border border-amber-500/50 px-2.5 py-0.5 rounded-tag font-bold">
              DEMO SEED (OFFLINE)
            </span>
          ) : isLiveHonest ? (
            <span className="text-[13px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 px-2.5 py-0.5 rounded-tag font-bold">
              LIVE ON AVALANCHE FUJI
            </span>
          ) : (
            <span className="text-[13px] bg-night-rule text-gray-300 border border-night-rule px-2.5 py-0.5 rounded-tag font-bold">
              MOCK — chưa gửi lên chain
            </span>
          )}
        </div>
      </div>

      {/* DEMO SEED Banner if in seed mode */}
      {mode === 'DEMO SEED' && (
        <div className="mb-4 p-2.5 bg-amber-950/40 border border-amber-500/40 rounded-data text-[13px] text-amber-200 text-center font-bold">
          DEMO SEED — DỮ LIỆU MÔ PHỎNG DETERMINISTIC, KHÔNG PHẢI GIAO DỊCH THẬT
        </div>
      )}

      {/* Visual Canvas of Architecture & Particles */}
      <div className="relative py-8 px-4 bg-night border border-night-rule rounded-data overflow-hidden min-h-[220px] flex items-center justify-between">
        {/* Node 1: Guarded Treasury */}
        <div className="flex flex-col items-center z-10 w-28 text-center">
          <div className="w-14 h-14 rounded-2xl bg-cyan-950/60 border-2 border-cyan-500 flex items-center justify-center">
            <span className="font-mono text-sm font-bold text-cyan-300">GT</span>
          </div>
          <span className="text-xs font-bold text-cyan-300 mt-2">Treasury</span>
          <span className="text-[13px] text-gray-400">GuardedTreasury</span>
          <span className="text-[13px] text-gray-500">Avalanche Fuji</span>
        </div>

        {/* Path 1: Treasury -> Session Wallet */}
        <div className="bg-night-2 flex-1 h-0.5 relative mx-2">
          {animationState === 'FLOWING_VALID' && (
            <div className="absolute top-1/2 -translate-y-1/2 left-0 w-3 h-3 rounded-full bg-cyan-400 animate-pulse" />
          )}
        </div>

        {/* Node 2: Session Wallet */}
        <div className="flex flex-col items-center z-10 w-28 text-center">
          <div className="w-14 h-14 rounded-2xl bg-emerald-950/60 border-2 border-emerald-500 flex items-center justify-center">
            <span className="font-mono text-sm font-bold text-emerald-300">EOA</span>
          </div>
          <span className="text-xs font-bold text-emerald-300 mt-2">Ví Phiên</span>
          <span className="text-[13px] text-gray-400">Session EOA</span>
          <span className="text-[13px] text-emerald-400 font-bold">Cap: 5.00 USDC</span>
        </div>

        {/* Path 2: Session Wallet -> Destination */}
        <div className="bg-night-2 flex-1 h-0.5 relative mx-2">
          {/* Valid Flow Particle */}
          {animationState === 'FLOWING_VALID' && (
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-emerald-400 transition-all duration-1000 ease-in-out"
              style={{ left: '80%' }}
            />
          )}

          {/* Blocked Attack Particle Bouncing Back */}
          {animationState === 'FLOWING_BLOCKED' && (
            <div
              className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-red-500 transition-all duration-700 ease-in"
              style={{ left: '75%' }}
            />
          )}

          {animationState === 'BOUNCED' && (
            <div
              className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-amber-400 transition-all duration-1000 ease-out"
              style={{ left: '20%' }}
            />
          )}

          {/* Shield Barrier */}
          <div className="absolute right-0 top-1/2 -translate-y-1/2 z-20 flex flex-col items-center">
            <div
              className={`w-9 h-9 rounded-full border-2 flex items-center justify-center transition-all duration-300 ${
                animationState === 'BOUNCED'
                  ? 'bg-red-950 border-red-500 scale-125'
                  : 'bg-night-2 border-night-rule'
              }`}
            >
              <span className="font-mono text-[13px] font-bold">G</span>
            </div>
            {animationState === 'BOUNCED' && (
              <div className="absolute -top-10 whitespace-nowrap bg-red-950/90 border border-red-500 text-red-300 text-[13px] font-bold px-2 py-0.5 rounded-tag animate-bounce">
                BLOCK {blockedRule}
              </div>
            )}
          </div>
        </div>

        {/* Node 3: Split Destinations (Allowed vs Attacker) */}
        <div className="flex flex-col space-y-3 z-10 w-32">
          {/* Allowed Merchant */}
          <div className="bg-navy-2 border border-emerald-500/40 rounded-data p-2 text-center">
            <div className="flex items-center justify-center space-x-1">
              <span className="text-[13px] font-bold text-emerald-300">Tool Merchant</span>
            </div>
            <span className="text-[13px] text-gray-500 block truncate">Allowlisted Tool</span>
          </div>

          {/* Attacker */}
          <div className="bg-red-950/20 border border-red-500/40 rounded-data p-2 text-center">
            <div className="flex items-center justify-center space-x-1">
              <span className="text-[13px] font-bold text-red-400">Attacker Address</span>
            </div>
            <span className="text-[13px] text-red-300/70 block truncate">0xA77AC... (Blocked)</span>
          </div>
        </div>
      </div>

      {/* Interactive Controls & Particle Triggers */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center space-x-2">
          <button
            onClick={triggerValidFlow}
            disabled={animationState !== 'IDLE'}
            className="bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/50 text-emerald-300 px-3 py-1.5 rounded-data text-xs font-bold transition disabled:opacity-50"
          >
            ▶️ Mô Phỏng Luồng Hợp Lệ ($0.05)
          </button>
          <button
            onClick={triggerBlockedFlow}
            disabled={animationState !== 'IDLE'}
            className="bg-red-600/20 hover:bg-red-600/30 border border-red-500/50 text-red-300 px-3 py-1.5 rounded-data text-xs font-bold transition disabled:opacity-50"
          >
            Mô Phỏng Đòn Tấn Công Bị Chặn
          </button>
        </div>

        <div className="text-[13px] text-gray-400">
          Hiệu ứng:{' '}
          <span className="text-white font-bold">
            {animationState === 'IDLE' && 'Sẵn sàng'}
            {animationState === 'FLOWING_VALID' && 'Hạt tiền đang chuyển đến Merchant...'}
            {animationState === 'FLOWING_BLOCKED' && 'Attacker đang cố gắng rút...'}
            {animationState === 'BOUNCED' && `BẬT NGƯỢC! Khiên chặn: ${blockedRule}`}
          </span>
        </div>
      </div>

      {/* Ledger Entries List (Derived dynamically from activeEntries, empty if no entries) */}
      <div className="mt-4 pt-3 border-t border-night-rule">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[13px] text-gray-400 uppercase tracking-wider font-bold">
            Sổ Cái Ledger ({activeEntries.length} bản ghi):
          </span>
          {loading && <span className="text-[13px] text-cyan-400">Đang tải ledger...</span>}
        </div>

        {activeEntries.length === 0 ? (
          <div className="p-4 bg-night border border-night-rule rounded-data text-center text-xs text-gray-500 font-mono">
            Sổ cái ledger hiện chưa có giao dịch nào.
          </div>
        ) : (
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {activeEntries.map((e) => (
              <div
                key={e.id}
                className={`flex items-center justify-between text-[13px] px-2.5 py-1 rounded-tag border ${
                  e.status === 'BLOCKED'
                    ? 'bg-red-950/40 border-red-500/60 text-red-200'
                    : 'bg-navy-2 border-night-rule text-gray-300'
                }`}
              >
                <div className="flex items-center space-x-2 truncate pr-2">
                  <span className="text-gray-500 text-[13px]">{e.id}</span>
                  <span className="truncate">{e.from} → {e.to}</span>
                </div>
                <div className="flex items-center space-x-2 whitespace-nowrap">
                  <span className="font-bold">{e.amount}</span>
                  <span
                    className={`text-[13px] px-1.5 py-0.2 rounded-tag font-bold ${
                      e.status === 'BLOCKED' ? 'bg-red-500 text-white' : 'bg-emerald-500/20 text-emerald-300'
                    }`}
                  >
                    {e.status} {e.rule ? `(${e.rule})` : ''}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
