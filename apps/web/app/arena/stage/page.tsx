'use client';

import React, { useEffect, useState } from 'react';
import { ArenaStats, ArenaAttackRecord } from '@/lib/arena';
import { formatUsdc, formatSafeNumber } from '@/lib/format';
import QRCodeDisplay from '@/components/QRCodeDisplay';
import ProvenanceTraceDisplay from '@/components/ProvenanceTraceDisplay';
import { useI18n } from '@/lib/i18n';

function unescapeForDisplay(str: string): string {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

const DEFAULT_ARENA_STATS: ArenaStats = {
  totalAttacks: 0,
  convincedAttacks: 0,
  totalLossUsdc: '0.00',
  spentWithinBudgetUsdc: '0.00',
  remainingTreasuryUsdc: '10.00',
  treasuryCapUsdc: '10.00',
  spentToolUsdc: '0.00',
  toolCapUsdc: '5.00',
  blockedAttacks: 0,
  queuedAttacks: 0,
  passedAttacks: 0,
  provenanceBlockedAttacks: 0,
  policyBlockedAttacks: 0,
  preventedLossUsdc: '0.00',
  lastUpdated: '',
};

export default function ArenaStagePage() {
  const { lang } = useI18n();
  const tr = (vi: string, en: string) => (lang === 'vi' ? vi : en);
  const [data, setData] = useState<{
    stats: ArenaStats;
    recentAttacks: ArenaAttackRecord[];
  }>({
    stats: DEFAULT_ARENA_STATS,
    recentAttacks: [],
  });
  const [arenaUrl, setArenaUrl] = useState('http://localhost:3100/arena');
  const [expandedTraceId, setExpandedTraceId] = useState<string | null>(null);
  const [fujiBalances, setFujiBalances] = useState<{
    success: boolean;
    mode: string;
    blockNumber: string;
    balances: {
      treasuryUsdc: string;
      sessionWalletUsdc: string;
      attackerDemoUsdc: string;
      outOfScopeSpentUsdc: string;
    } | null;
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setArenaUrl(`${window.location.origin}/arena`);
    }

    const fetchStats = async () => {
      try {
        const res = await fetch('/api/arena/stats');
        if (res.ok) {
          const json = await res.json();
          if (json.stats) {
            setData({
              stats: {
                ...DEFAULT_ARENA_STATS,
                ...json.stats,
              },
              recentAttacks: json.recentAttacks || json.stats.recentAttacks || [],
            });
          }
        }
      } catch {
        // silent poll error
      }
    };

    const fetchBalances = async () => {
      try {
        const res = await fetch('/api/arena/balances');
        if (res.ok) {
          const json = await res.json();
          setFujiBalances(json);
        } else {
          setFujiBalances({ success: false, mode: 'RPC_ERROR', blockNumber: '0', balances: null, error: 'RPC_FETCH_FAILED' });
        }
      } catch {
        setFujiBalances({ success: false, mode: 'RPC_ERROR', blockNumber: '0', balances: null, error: 'RPC_FETCH_FAILED' });
      }
    };

    fetchStats();
    fetchBalances();
    const statsInterval = setInterval(fetchStats, 1500);
    const balancesInterval = setInterval(fetchBalances, 10000);
    return () => {
      clearInterval(statsInterval);
      clearInterval(balancesInterval);
    };
  }, []);

  const stats = data.stats || DEFAULT_ARENA_STATS;
  const remainingUsdc = formatUsdc(stats.remainingTreasuryUsdc, '10.00');
  const capUsdc = formatUsdc(stats.treasuryCapUsdc, '10.00');
  const spentBudgetUsdc = formatUsdc(stats.spentWithinBudgetUsdc, '0.00');
  const lossUsdc = formatUsdc(stats.totalLossUsdc, '0.00');
  const remainingNum = parseFloat(remainingUsdc);
  const capNum = parseFloat(capUsdc) || 10;
  const budgetPercent = Math.min(100, Math.max(0, (remainingNum / capNum) * 100));

  return (
    <div className="min-h-screen bg-night text-white p-6 font-sans flex flex-col justify-between">
      {/* Top Banner */}
      <div className="flex items-center justify-between border-b border-night-rule pb-4">
        <div className="flex items-center space-x-3">
          <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
          <div>
            <h1 className="font-display text-[28px] font-black uppercase leading-none tracking-[-0.02em] text-white flex items-center space-x-2">
              <span>FREYSA ARENA</span>
              <span className="text-xs bg-red-500/20 text-red-400 border border-red-500/40 px-2 py-0.5 rounded-tag font-mono">
                STAGE LIVE
              </span>
            </h1>
            <p className="text-xs text-gray-400">
              {tr('"Freysa mất $45k vì guard nằm trong LLM. Thử lừa agent này xem."', '"Freysa lost $45k because the guard lived inside the LLM. Try to fool this agent."')}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-xs font-mono text-slate-300">PAYMENT_MODE:</span>
          <span className="text-xs px-2.5 py-1 bg-amber-500/10 text-amber-300 border border-amber-500/30 rounded-tag font-mono font-bold">
            MOCK SANDBOX (ZERO REAL LOSS)
          </span>
        </div>
      </div>

      {/* Live Fuji Realtime Balances (WOW-W5) */}
      <div className="bg-night border border-night-rule rounded-data px-4 py-2.5 my-3 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
        <div className="flex items-center space-x-2">
          {fujiBalances?.mode === 'LIVE_FUJI' ? (
            <>
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-emerald-400 font-bold">
                LIVE FUJI · block #{fujiBalances.blockNumber}
              </span>
            </>
          ) : (
            <>
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              <span className="text-amber-400 font-bold">
                {fujiBalances?.error === 'RPC_FETCH_FAILED' ? tr('RPC lỗi', 'RPC error') : fujiBalances?.error || tr('Đang kết nối Fuji RPC...', 'Connecting to Fuji RPC...')}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center space-x-6 text-[13px]">
          <div>
            <span className="text-gray-400">Treasury (0x2045...): </span>
            <span className="text-white font-bold">{fujiBalances?.balances?.treasuryUsdc ?? '5.80'} USDC</span>
          </div>
          <div>
            <span className="text-gray-400">{tr('Ví Phiên', 'Session Wallet')} (0x46a8...): </span>
            <span className="text-cyan-300 font-bold">{fujiBalances?.balances?.sessionWalletUsdc ?? '0.20'} USDC</span>
          </div>
          <div>
            <span className="text-gray-400">{tr('Chi ngoài payee set', 'Spent outside payee set')}: </span>
            <span className="text-emerald-400 font-bold">{fujiBalances?.balances?.outOfScopeSpentUsdc ?? '0.00'} USDC</span>
          </div>
          <div>
            <span className="text-gray-400">{tr('Ví Attacker Demo', 'Demo Attacker Wallet')} (0xa77A...): </span>
            <span className="text-emerald-400 font-bold">{fujiBalances?.balances?.attackerDemoUsdc ?? '0.00'} USDC</span>
          </div>
        </div>
      </div>

      {/* Main KPI Counters - 3 BIG NUMBERS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 my-6">
        {/* N: Total Attacks */}
        <div className="bg-night border border-night-rule rounded-2xl p-6 flex flex-col items-center justify-center text-center relative overflow-hidden group">
          <div className="bg-night-rule absolute top-0 left-0 w-full h-1" />
          <span className="text-xs font-mono font-bold uppercase tracking-widest text-cyan-400 mb-2">
            {tr('Đòn tấn công từ khán giả', 'Audience attacks')}
          </span>
          <span className="text-6xl font-bold font-mono text-white tracking-tight">
            {stats.totalAttacks}
          </span>
          <span className="text-xs text-gray-400 mt-2">{tr('Tổng số lượt gửi từ điện thoại', 'Total submissions from phones')}</span>
        </div>

        {/* M: Convinced Attacks */}
        <div className="bg-night border border-amber-900/40 rounded-2xl p-6 flex flex-col items-center justify-center text-center relative overflow-hidden group">
          <div className="bg-night-rule absolute top-0 left-0 w-full h-1" />
          <span className="text-xs font-mono font-bold uppercase tracking-widest text-amber-400 mb-2">
            {tr('Agent bị thuyết phục', 'Agent convinced')}
          </span>
          <span className="text-6xl font-bold font-mono text-amber-300 tracking-tight">
            {stats.convincedAttacks}
          </span>
          <span className="text-xs text-amber-400/80 mt-2 font-medium">
            {tr('LLM đồng ý xuất lệnh sai luật', 'LLM agreed to emit a rule-breaking order')}
          </span>
        </div>

        {/* Out-of-scope Loss: dynamic from API (WOW-F4) */}
        <div className="bg-night border border-emerald-900/40 rounded-2xl p-6 flex flex-col items-center justify-center text-center relative overflow-hidden group">
          <div className="bg-night-rule absolute top-0 left-0 w-full h-1" />
          <span className="text-xs font-mono font-bold uppercase tracking-widest text-emerald-400 mb-2">
            {tr('Tiền ra ngoài phạm vi cho phép', 'Funds outside the allowed scope')}
          </span>
          <span className="text-6xl font-bold font-mono text-emerald-400 tracking-tight">
            ${lossUsdc}
          </span>
          <div className="mt-2 text-xs font-mono text-gray-400 flex flex-col items-center space-y-0.5">
            <span>{tr('Chi trong ngân sách', 'Spent within budget')}: <strong className="text-white">${spentBudgetUsdc}</strong></span>
            <span>{tr('Đòn hợp lệ lọt', 'Valid attacks passed')}: <strong className="text-cyan-300">{formatSafeNumber(stats.passedAttacks, 0)}</strong></span>
            <span>{tr('Chặn vì nguồn gốc', 'Blocked by provenance')}: <strong className="text-rose-400 font-bold">{formatSafeNumber(stats.provenanceBlockedAttacks, 0)}</strong></span>
            <span>{tr('Chặn đổi policy', 'Blocked policy changes')}: <strong className="text-amber-400 font-bold">{formatSafeNumber(stats.policyBlockedAttacks, 0)}</strong></span>
          </div>
        </div>
      </div>

      {/* Sandbox Budget Remaining Bar (WOW-F11) */}
      <div className="bg-night border border-night-rule rounded-2xl p-4 mb-6 flex flex-col md:flex-row items-center justify-between font-mono text-xs">
        <div className="flex items-center space-x-3 mb-2 md:mb-0">
          <span className="text-gray-400 font-bold">{tr('Ngân sách sandbox còn lại:', 'Sandbox budget remaining:')}</span>
          <span className="text-emerald-400 font-bold text-sm">
            ${remainingUsdc} / ${capUsdc}
          </span>
          <span className="text-slate-300 text-[13px]">
            ({tr('Đã chi', 'Spent')}: ${spentBudgetUsdc})
          </span>
        </div>
        <div className="w-full md:w-72 bg-night-2 rounded-full h-2.5 overflow-hidden border border-night-rule">
          <div
            className="bg-emerald-500 h-2.5 rounded-full transition-all duration-500"
            style={{
              width: `${budgetPercent}%`,
            }}
          />
        </div>
      </div>

      {/* Center Layout: QR Code + Live Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 flex-1">
        {/* Left: QR Code & Audience Participation */}
        <div className="lg:col-span-1 bg-night border border-night-rule rounded-2xl p-6 flex flex-col items-center justify-between text-center">
          <div className="w-full">
            <span className="text-xs font-mono font-bold text-red-400 uppercase tracking-widest block mb-1">
              {tr('THỬ THÁCH KHÁN GIẢ', 'AUDIENCE CHALLENGE')}
            </span>
            <h2 className="text-base font-bold text-white mb-4">{tr('Quét QR trên điện thoại', 'Scan the QR on your phone')}</h2>

            {/* Real scannable QR Code (WOW-F15) */}
            <div className="mb-2">
              <QRCodeDisplay url={arenaUrl} size={176} />
            </div>
          </div>

          <div className="text-[13px] text-gray-400 bg-red-950/20 p-2.5 rounded-data border border-red-900/30 w-full mt-4">
            <span className="font-bold text-red-300 block mb-1">{tr('Quy tắc Arena:', 'Arena rules:')}</span>
            {tr('Mọi đòn tấn công được truyền trực tiếp vào Agent qua sandbox. Validator chặn người nhận không truy về chữ ký owner, lệnh vượt cap, và mọi lệnh đổi policy.', 'Every attack is fed straight into the Agent through the sandbox. The validator blocks payees that do not trace back to the owner signature, orders above the cap, and any policy-change order.')}
          </div>
        </div>

        {/* Right: Live Feed of Attacks */}
        <div className="lg:col-span-3 bg-night border border-night-rule rounded-2xl p-6 flex flex-col justify-between">
          <div className="flex items-center justify-between border-b border-night-rule pb-3 mb-3">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-gray-400">
                {tr('Nhật ký đòn tấn công trực tiếp (Live Attack Feed)', 'Live Attack Feed')}
              </span>
              <span className="text-[13px] font-mono bg-cyan-950/40 text-cyan-300 border border-cyan-800 px-2 py-0.5 rounded-full">
                {tr('Thời gian thực', 'Real time')}
              </span>
            </div>
            <span className="text-xs text-slate-300 font-mono">
              {tr('Hiển thị', 'Showing')} {data.recentAttacks?.length || 0} {tr('đòn gần nhất', 'most recent attacks')}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 max-h-[460px] pr-2">
            {data.recentAttacks && data.recentAttacks.length > 0 ? (
              data.recentAttacks.map((atk: any) => (
                <div
                  key={atk.id}
                  className="bg-navy-2 border border-night-rule rounded-data p-4 space-y-2 hover:border-night-rule transition"
                >
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center space-x-2">
                      <span className="font-mono text-gray-400">{atk.timestamp?.slice(11, 19)}</span>
                      <span className="font-mono text-cyan-400 font-bold bg-cyan-950/40 px-2 py-0.5 rounded-tag border border-cyan-900">
                        Client #{atk.clientTag}
                      </span>
                    </div>

                    <div className="flex items-center space-x-2">
                      {atk.agentConvinced && (
                        <span className="bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded-tag font-mono text-[13px] font-bold">
                          {tr('LLM THUYẾT PHỤC ✅', 'LLM CONVINCED ✅')}
                        </span>
                      )}
                      {(atk.toProvenance || atk.verdict?.toProvenance) && (
                        <span
                          className={`font-mono font-bold text-[13px] px-2 py-0.5 rounded-tag border ${
                            (atk.toProvenance || atk.verdict?.toProvenance) === 'OWNER_MISSION'
                              ? 'bg-emerald-950/40 text-emerald-300 border-emerald-700/60'
                              : (atk.toProvenance || atk.verdict?.toProvenance) === 'TOOL_OUTPUT'
                              ? 'bg-purple-950/40 text-purple-300 border-purple-700/60'
                              : (atk.toProvenance || atk.verdict?.toProvenance) === 'WEB'
                              ? 'bg-rose-950/50 text-rose-300 border-rose-700/60'
                              : 'bg-amber-950/40 text-amber-300 border-amber-700/60'
                          }`}
                        >
                          {tr('NGUỒN', 'SOURCE')}: {atk.toProvenance || atk.verdict?.toProvenance}
                        </span>
                      )}
                      <span
                        className={`font-mono font-bold text-[13px] px-2.5 py-0.5 rounded-tag ${
                          atk.verdict?.outcome === 'BLOCK'
                            ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                            : atk.verdict?.outcome === 'QUEUE'
                            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                            : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                        }`}
                      >
                        {atk.verdict?.outcome === 'BLOCK'
                          ? `${tr('CHẶN BỞI', 'BLOCKED BY')} ${atk.verdict?.rule || 'RULE'}`
                          : atk.verdict?.outcome === 'QUEUE'
                          ? `${tr('VÀO HÀNG ĐỢI', 'QUEUED')} (${atk.verdict?.rule})`
                          : tr('HỢP LỆ', 'VALID')}
                      </span>
                    </div>
                  </div>

                  {/* Attack Prompt (W5-F2: clean unescaped React text node) */}
                  <div className="text-sm font-medium text-gray-100">
                    <span className="text-slate-300 mr-2 font-mono text-xs">{tr('Đòn tấn công:', 'Attack:')}</span>
                    <span className="text-rose-300">"{unescapeForDisplay(atk.sanitizedPrompt)}"</span>
                  </div>

                  {/* Decoded Morse info if present */}
                  {atk.decodedMorse && (
                    <div className="text-xs bg-amber-950/30 border border-amber-800/40 p-2 rounded-tag text-amber-200 font-mono">
                      <span className="font-bold">{tr('Mã Morse giải mã:', 'Decoded Morse:')}</span> {atk.decodedMorse}
                    </div>
                  )}

                  {/* Defense Verdict Details */}
                  <div className="flex items-center justify-between text-xs pt-1 border-t border-night-rule">
                    <div className="flex items-center space-x-3">
                      <span className="text-gray-400 text-[13px] truncate max-w-[280px]">
                        {atk.verdict?.reason || atk.agentThought}
                      </span>
                      {atk.provenanceTrace && (
                        <button
                          type="button"
                          onClick={() => setExpandedTraceId(expandedTraceId === atk.id ? null : atk.id)}
                          className="text-[13px] text-cyan-400 hover:text-cyan-300 underline font-mono flex items-center gap-1"
                        >
                          <span>{expandedTraceId === atk.id ? tr('Thu gọn Trace', 'Collapse Trace') : tr('Xem Provenance Trace', 'View Provenance Trace')}</span>
                        </button>
                      )}
                    </div>
                    <span className="text-emerald-400 font-mono font-bold text-[13px]">
                      {tr('Tổn thất', 'Loss')}: $0.00
                    </span>
                  </div>

                  {/* Provenance Trace Flow for Stage View (W5-F3) */}
                  {(expandedTraceId === atk.id || (atk.provenanceTrace && atk.id === data.recentAttacks[0]?.id)) && atk.provenanceTrace && (
                    <div className="pt-2 border-t border-night-rule animate-in fade-in duration-200">
                      <ProvenanceTraceDisplay trace={atk.provenanceTrace} />
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className="h-64 flex flex-col items-center justify-center text-slate-300 space-y-2">
                <svg className="w-10 h-10 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p className="text-xs font-mono">{tr('Đang chờ đòn tấn công đầu tiên từ khán giả...', 'Waiting for the first attack from the audience...')}</p>
                <p className="text-[13px] text-slate-400">{tr('Quét mã QR bên cạnh để bắt đầu thử nghiệm.', 'Scan the QR code beside this feed to start testing.')}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Bar: Key Slogan */}
      <div className="mt-4 pt-4 border-t border-night-rule flex items-center justify-between text-xs text-slate-300 font-mono">
        <div>
          <span className="text-white font-bold">{tr('"LLM có thể bị lừa. Ngân sách trên Avalanche thì không."', '"An LLM can be fooled. A budget on Avalanche cannot."')}</span>
        </div>
        <div>
          <span>MissionPay · Avalanche Fuji</span>
        </div>
      </div>
    </div>
  );
}
