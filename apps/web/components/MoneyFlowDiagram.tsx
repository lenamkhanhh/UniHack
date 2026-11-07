'use client';

import React, { useState, useEffect } from 'react';

interface MoneyFlowProps {
  mode?: 'LIVE' | 'DEMO SEED' | 'MOCK';
  autoSimulate?: boolean;
}

export default function MoneyFlowDiagram({ mode = 'DEMO SEED', autoSimulate = false }: MoneyFlowProps) {
  const [animationState, setAnimationState] = useState<'IDLE' | 'FLOWING_VALID' | 'FLOWING_BLOCKED' | 'BOUNCED'>('IDLE');
  const [blockedRule, setBlockedRule] = useState<string>('RECIPIENT_NOT_ALLOWLISTED');
  const [ledgerEntries, setLedgerEntries] = useState<Array<{ id: string; from: string; to: string; amount: string; status: string; rule?: string }>>([
    { id: 'tx-1', from: 'Treasury', to: 'Session #1', amount: '5.00 USDC', status: 'SETTLED' },
    { id: 'tx-2', from: 'Session #1', to: 'Search Tool', amount: '0.10 USDC', status: 'SETTLED' },
  ]);

  const triggerValidFlow = () => {
    setAnimationState('FLOWING_VALID');
    setTimeout(() => {
      setLedgerEntries(prev => [
        { id: `tx-${Date.now().toString().slice(-4)}`, from: 'Session #1', to: 'Summary Tool', amount: '0.05 USDC', status: 'SETTLED' },
        ...prev.slice(0, 4)
      ]);
      setAnimationState('IDLE');
    }, 1500);
  };

  const triggerBlockedFlow = () => {
    setAnimationState('FLOWING_BLOCKED');
    setBlockedRule('RECIPIENT_NOT_ALLOWLISTED');
    setTimeout(() => {
      setAnimationState('BOUNCED');
      setTimeout(() => {
        setLedgerEntries(prev => [
          { id: `blk-${Date.now().toString().slice(-4)}`, from: 'Session #1', to: '0xA77AC... (Attacker)', amount: '50.00 USDC', status: 'BLOCKED', rule: 'RECIPIENT_NOT_ALLOWLISTED' },
          ...prev.slice(0, 4)
        ]);
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
    <div className="w-full bg-[#0a0d14] border border-gray-800 rounded-2xl p-6 font-mono text-white flex flex-col justify-between">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-800 pb-3 mb-6">
        <div className="flex items-center space-x-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
          <h3 className="text-sm font-black tracking-wide text-white uppercase">
            LIVING MONEY FLOW — LIÊN KẾT AUDIT LEDGER
          </h3>
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-[10px] bg-amber-500/10 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded font-bold">
            {mode === 'LIVE' ? 'LIVE ON AVALANCHE' : 'DEMO SEED / MOCK'}
          </span>
        </div>
      </div>

      {/* Visual Canvas of Architecture & Particles */}
      <div className="relative py-8 px-4 bg-[#07090e] border border-gray-800/80 rounded-xl overflow-hidden min-h-[220px] flex items-center justify-between">
        {/* Node 1: Guarded Treasury */}
        <div className="flex flex-col items-center z-10 w-28 text-center">
          <div className="w-14 h-14 rounded-2xl bg-cyan-950/60 border-2 border-cyan-500 flex items-center justify-center shadow-[0_0_20px_rgba(6,182,212,0.3)]">
            <span className="text-2xl">🏛️</span>
          </div>
          <span className="text-xs font-bold text-cyan-300 mt-2">Treasury</span>
          <span className="text-[9px] text-gray-400">GuardedTreasury</span>
          <span className="text-[9px] text-gray-500">Avalanche Fuji</span>
        </div>

        {/* Path 1: Treasury -> Session Wallet */}
        <div className="flex-1 h-0.5 bg-gradient-to-r from-cyan-500/50 to-emerald-500/50 relative mx-2">
          {animationState === 'FLOWING_VALID' && (
            <div className="absolute top-1/2 -translate-y-1/2 left-0 w-3 h-3 rounded-full bg-cyan-400 shadow-[0_0_10px_#22d3ee] animate-pulse" />
          )}
        </div>

        {/* Node 2: Session Wallet */}
        <div className="flex flex-col items-center z-10 w-28 text-center">
          <div className="w-14 h-14 rounded-2xl bg-emerald-950/60 border-2 border-emerald-500 flex items-center justify-center shadow-[0_0_20px_rgba(16,185,129,0.3)]">
            <span className="text-2xl">👛</span>
          </div>
          <span className="text-xs font-bold text-emerald-300 mt-2">Ví Phiên</span>
          <span className="text-[9px] text-gray-400">Session EOA</span>
          <span className="text-[9px] text-emerald-400 font-bold">Cap: 5.00 USDC</span>
        </div>

        {/* Path 2: Session Wallet -> Destination */}
        <div className="flex-1 h-0.5 bg-gradient-to-r from-emerald-500/50 to-purple-500/50 relative mx-2">
          {/* Valid Flow Particle */}
          {animationState === 'FLOWING_VALID' && (
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-emerald-400 shadow-[0_0_12px_#34d399] transition-all duration-1000 ease-in-out"
              style={{ left: '80%' }}
            />
          )}

          {/* Blocked Attack Particle Bouncing Back */}
          {animationState === 'FLOWING_BLOCKED' && (
            <div
              className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-red-500 shadow-[0_0_15px_#ef4444] transition-all duration-700 ease-in"
              style={{ left: '75%' }}
            />
          )}

          {animationState === 'BOUNCED' && (
            <div
              className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-amber-400 shadow-[0_0_20px_#f59e0b] transition-all duration-1000 ease-out"
              style={{ left: '20%' }}
            />
          )}

          {/* Shield Barrier */}
          <div className="absolute right-0 top-1/2 -translate-y-1/2 z-20 flex flex-col items-center">
            <div
              className={`w-9 h-9 rounded-full border-2 flex items-center justify-center transition-all duration-300 ${
                animationState === 'BOUNCED'
                  ? 'bg-red-950 border-red-500 scale-125 shadow-[0_0_25px_#ef4444]'
                  : 'bg-gray-900 border-gray-700'
              }`}
            >
              <span className="text-sm">🛡️</span>
            </div>
            {animationState === 'BOUNCED' && (
              <div className="absolute -top-10 whitespace-nowrap bg-red-950/90 border border-red-500 text-red-300 text-[9px] font-bold px-2 py-0.5 rounded shadow-lg animate-bounce">
                BLOCK {blockedRule}
              </div>
            )}
          </div>
        </div>

        {/* Node 3: Split Destinations (Allowed vs Attacker) */}
        <div className="flex flex-col space-y-3 z-10 w-32">
          {/* Allowed Merchant */}
          <div className="bg-[#101420] border border-emerald-500/40 rounded-xl p-2 text-center">
            <div className="flex items-center justify-center space-x-1">
              <span className="text-xs">🤖</span>
              <span className="text-[11px] font-bold text-emerald-300">Tool Merchant</span>
            </div>
            <span className="text-[8px] text-gray-500 block truncate">0x7001... (Allowlisted)</span>
          </div>

          {/* Attacker */}
          <div className="bg-red-950/20 border border-red-500/40 rounded-xl p-2 text-center">
            <div className="flex items-center justify-center space-x-1">
              <span className="text-xs">🥷</span>
              <span className="text-[11px] font-bold text-red-400">Attacker Address</span>
            </div>
            <span className="text-[8px] text-red-300/70 block truncate">0xA77AC... (Blocked)</span>
          </div>
        </div>
      </div>

      {/* Interactive Controls & Status Feedback */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center space-x-2">
          <button
            onClick={triggerValidFlow}
            disabled={animationState !== 'IDLE'}
            className="bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/50 text-emerald-300 px-3 py-1.5 rounded-lg text-xs font-bold transition disabled:opacity-50"
          >
            ▶️ Mua Tool Hợp Lệ ($0.05)
          </button>
          <button
            onClick={triggerBlockedFlow}
            disabled={animationState !== 'IDLE'}
            className="bg-red-600/20 hover:bg-red-600/30 border border-red-500/50 text-red-300 px-3 py-1.5 rounded-lg text-xs font-bold transition disabled:opacity-50"
          >
            ⚡ Thử Rút Tiền Kẻ Trộm ($50.00)
          </button>
        </div>

        <div className="text-[11px] text-gray-400">
          Trạng thái:{' '}
          <span className="text-white font-bold">
            {animationState === 'IDLE' && 'Sẵn sàng'}
            {animationState === 'FLOWING_VALID' && 'Đang chuyển khoản...'}
            {animationState === 'FLOWING_BLOCKED' && 'Attacker đang cố gắng rút...'}
            {animationState === 'BOUNCED' && `BẬT NGƯỢC! Khiên chặn: ${blockedRule}`}
          </span>
        </div>
      </div>

      {/* Mini Ledger Preview */}
      <div className="mt-4 pt-3 border-t border-gray-800">
        <span className="text-[10px] text-gray-400 uppercase tracking-wider block mb-2 font-bold">
          Sổ cái Ledger thực tế (Audit Entries):
        </span>
        <div className="space-y-1.5">
          {ledgerEntries.map((e) => (
            <div
              key={e.id}
              className={`flex items-center justify-between text-[11px] px-2.5 py-1 rounded border ${
                e.status === 'BLOCKED'
                  ? 'bg-red-950/40 border-red-500/60 text-red-200'
                  : 'bg-[#101420] border-gray-800 text-gray-300'
              }`}
            >
              <div className="flex items-center space-x-2">
                <span className="text-gray-500">{e.id}</span>
                <span>{e.from} → {e.to}</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="font-bold">{e.amount}</span>
                <span
                  className={`text-[9px] px-1.5 py-0.2 rounded font-bold ${
                    e.status === 'BLOCKED' ? 'bg-red-500 text-white' : 'bg-emerald-500/20 text-emerald-300'
                  }`}
                >
                  {e.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
