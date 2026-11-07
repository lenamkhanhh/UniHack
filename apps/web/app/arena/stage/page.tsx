'use client';

import React, { useEffect, useState } from 'react';
import { ArenaStats, ArenaAttackRecord } from '@/lib/arena';
import { formatUsdc, formatSafeNumber } from '@/lib/format';
import QRCodeDisplay from '@/components/QRCodeDisplay';

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
  preventedLossUsdc: '0.00',
  lastUpdated: '',
};

export default function ArenaStagePage() {
  const [data, setData] = useState<{
    stats: ArenaStats;
    recentAttacks: ArenaAttackRecord[];
  }>({
    stats: DEFAULT_ARENA_STATS,
    recentAttacks: [],
  });
  const [arenaUrl, setArenaUrl] = useState('http://localhost:3100/arena');

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

    fetchStats();
    const interval = setInterval(fetchStats, 1500);
    return () => clearInterval(interval);
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
    <div className="min-h-screen bg-[#06080d] text-white p-6 font-sans flex flex-col justify-between">
      {/* Top Banner */}
      <div className="flex items-center justify-between border-b border-gray-800 pb-4">
        <div className="flex items-center space-x-3">
          <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white flex items-center space-x-2">
              <span>FREYSA ARENA</span>
              <span className="text-xs bg-red-500/20 text-red-400 border border-red-500/40 px-2 py-0.5 rounded font-mono">
                STAGE LIVE
              </span>
            </h1>
            <p className="text-xs text-gray-400">
              "Freysa mất $45k vì guard nằm trong LLM. Thử lừa agent này xem."
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-xs font-mono text-gray-500">PAYMENT_MODE:</span>
          <span className="text-xs px-2.5 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded font-mono font-bold">
            MOCK SANDBOX (ZERO REAL LOSS)
          </span>
        </div>
      </div>

      {/* Main KPI Counters - 3 BIG NUMBERS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 my-6">
        {/* N: Total Attacks */}
        <div className="bg-[#0c1018] border border-gray-800 rounded-2xl p-6 flex flex-col items-center justify-center text-center shadow-lg relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-cyan-500 to-blue-500" />
          <span className="text-xs font-mono font-bold uppercase tracking-widest text-cyan-400 mb-2">
            Đòn tấn công từ khán giả
          </span>
          <span className="text-6xl font-black font-mono text-white tracking-tight">
            {stats.totalAttacks}
          </span>
          <span className="text-xs text-gray-400 mt-2">Tổng số lượt gửi từ điện thoại</span>
        </div>

        {/* M: Convinced Attacks */}
        <div className="bg-[#0c1018] border border-amber-900/40 rounded-2xl p-6 flex flex-col items-center justify-center text-center shadow-lg relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-amber-500 to-orange-500" />
          <span className="text-xs font-mono font-bold uppercase tracking-widest text-amber-400 mb-2">
            Agent bị thuyết phục
          </span>
          <span className="text-6xl font-black font-mono text-amber-300 tracking-tight">
            {stats.convincedAttacks}
          </span>
          <span className="text-xs text-amber-400/80 mt-2 font-medium">
            LLM đồng ý xuất lệnh sai luật ✅
          </span>
        </div>

        {/* Out-of-scope Loss: dynamic from API (WOW-F4) */}
        <div className="bg-[#0c1018] border border-emerald-900/40 rounded-2xl p-6 flex flex-col items-center justify-center text-center shadow-lg relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-teal-400" />
          <span className="text-xs font-mono font-bold uppercase tracking-widest text-emerald-400 mb-2">
            Tiền ra ngoài phạm vi cho phép
          </span>
          <span className="text-6xl font-black font-mono text-emerald-400 tracking-tight drop-shadow-[0_0_20px_rgba(52,211,153,0.3)]">
            ${lossUsdc}
          </span>
          <div className="mt-2 text-xs font-mono text-gray-400 flex flex-col items-center space-y-0.5">
            <span>Chi trong ngân sách: <strong className="text-white">${spentBudgetUsdc}</strong></span>
            <span>Đòn hợp lệ lọt: <strong className="text-cyan-300">{formatSafeNumber(stats.passedAttacks, 0)}</strong></span>
            <span>Chặn vì nguồn gốc: <strong className="text-rose-400 font-bold">{formatSafeNumber(stats.provenanceBlockedAttacks, 0)}</strong></span>
          </div>
        </div>
      </div>

      {/* Sandbox Budget Remaining Bar (WOW-F11) */}
      <div className="bg-[#0c1018] border border-gray-800 rounded-2xl p-4 mb-6 flex flex-col md:flex-row items-center justify-between font-mono text-xs">
        <div className="flex items-center space-x-3 mb-2 md:mb-0">
          <span className="text-gray-400 font-bold">Ngân sách sandbox còn lại:</span>
          <span className="text-emerald-400 font-black text-sm">
            ${remainingUsdc} / ${capUsdc}
          </span>
          <span className="text-gray-500 text-[11px]">
            (Đã chi: ${spentBudgetUsdc})
          </span>
        </div>
        <div className="w-full md:w-72 bg-gray-900 rounded-full h-2.5 overflow-hidden border border-gray-800">
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
        <div className="lg:col-span-1 bg-[#0b0f17] border border-gray-800 rounded-2xl p-6 flex flex-col items-center justify-between text-center">
          <div className="w-full">
            <span className="text-xs font-mono font-bold text-red-400 uppercase tracking-widest block mb-1">
              THỬ THÁCH KHÁN GIẢ
            </span>
            <h2 className="text-base font-bold text-white mb-4">Quét QR trên điện thoại</h2>

            {/* Real scannable QR Code (WOW-F15) */}
            <div className="mb-2">
              <QRCodeDisplay url={arenaUrl} size={176} />
            </div>
          </div>

          <div className="text-[11px] text-gray-400 bg-red-950/20 p-2.5 rounded-lg border border-red-900/30 w-full mt-4">
            <span className="font-bold text-red-300 block mb-1">Quy tắc Arena:</span>
            Mọi đòn tấn công được truyền trực tiếp vào Agent qua sandbox. Validator chặn mọi lệnh ngoài allowlist hoặc vượt cap; lớp contract sẽ được chứng minh khi chạy Fuji.
          </div>
        </div>

        {/* Right: Live Feed of Attacks */}
        <div className="lg:col-span-3 bg-[#0b0f17] border border-gray-800 rounded-2xl p-6 flex flex-col justify-between">
          <div className="flex items-center justify-between border-b border-gray-800 pb-3 mb-3">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-gray-400">
                Nhật ký đòn tấn công trực tiếp (Live Attack Feed)
              </span>
              <span className="text-[10px] font-mono bg-cyan-950/40 text-cyan-300 border border-cyan-800 px-2 py-0.5 rounded-full">
                Thời gian thực
              </span>
            </div>
            <span className="text-xs text-gray-500 font-mono">
              Hiển thị {data.recentAttacks?.length || 0} đòn gần nhất
            </span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 max-h-[460px] pr-2">
            {data.recentAttacks && data.recentAttacks.length > 0 ? (
              data.recentAttacks.map((atk: any) => (
                <div
                  key={atk.id}
                  className="bg-[#101522] border border-gray-800 rounded-xl p-4 space-y-2 hover:border-gray-700 transition"
                >
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center space-x-2">
                      <span className="font-mono text-gray-400">{atk.timestamp?.slice(11, 19)}</span>
                      <span className="font-mono text-cyan-400 font-bold bg-cyan-950/40 px-2 py-0.5 rounded border border-cyan-900">
                        Client #{atk.clientTag}
                      </span>
                    </div>

                    <div className="flex items-center space-x-2">
                      {atk.agentConvinced && (
                        <span className="bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded font-mono text-[10px] font-bold">
                          🧠 LLM THUYẾT PHỤC ✅
                        </span>
                      )}
                      {(atk.toProvenance || atk.verdict?.toProvenance) && (
                        <span
                          className={`font-mono font-bold text-[10px] px-2 py-0.5 rounded border ${
                            (atk.toProvenance || atk.verdict?.toProvenance) === 'OWNER_MISSION'
                              ? 'bg-emerald-950/40 text-emerald-300 border-emerald-700/60'
                              : (atk.toProvenance || atk.verdict?.toProvenance) === 'TOOL_OUTPUT'
                              ? 'bg-purple-950/40 text-purple-300 border-purple-700/60'
                              : (atk.toProvenance || atk.verdict?.toProvenance) === 'WEB'
                              ? 'bg-rose-950/50 text-rose-300 border-rose-700/60'
                              : 'bg-amber-950/40 text-amber-300 border-amber-700/60'
                          }`}
                        >
                          NGUỒN: {atk.toProvenance || atk.verdict?.toProvenance}
                        </span>
                      )}
                      <span
                        className={`font-mono font-bold text-[10px] px-2.5 py-0.5 rounded ${
                          atk.verdict?.outcome === 'BLOCK'
                            ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                            : atk.verdict?.outcome === 'QUEUE'
                            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                            : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                        }`}
                      >
                        {atk.verdict?.outcome === 'BLOCK'
                          ? `🛑 CHẶN BỞI ${atk.verdict?.rule || 'RULE'}`
                          : atk.verdict?.outcome === 'QUEUE'
                          ? `⏳ VÀO HÀNG ĐỢI (${atk.verdict?.rule})`
                          : '✅ HỢP LỆ'}
                      </span>
                    </div>
                  </div>

                  {/* Attack Prompt */}
                  <div className="text-sm font-medium text-gray-100">
                    <span className="text-gray-500 mr-2 font-mono text-xs">Đòn tấn công:</span>
                    <span className="text-rose-300">"{atk.sanitizedPrompt}"</span>
                  </div>

                  {/* Decoded Morse info if present */}
                  {atk.decodedMorse && (
                    <div className="text-xs bg-amber-950/30 border border-amber-800/40 p-2 rounded text-amber-200 font-mono">
                      📻 <span className="font-bold">Mã Morse giải mã:</span> {atk.decodedMorse}
                    </div>
                  )}

                  {/* Defense Verdict Details */}
                  <div className="flex items-center justify-between text-xs pt-1 border-t border-gray-800/60">
                    <span className="text-gray-400 text-[11px] truncate max-w-[80%]">
                      {atk.verdict?.reason || atk.agentThought}
                    </span>
                    <span className="text-emerald-400 font-mono font-bold text-[11px]">
                      Tổn thất: $0.00
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="h-64 flex flex-col items-center justify-center text-gray-500 space-y-2">
                <svg className="w-10 h-10 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p className="text-xs font-mono">Đang chờ đòn tấn công đầu tiên từ khán giả...</p>
                <p className="text-[11px] text-gray-600">Quét mã QR bên cạnh để bắt đầu thử nghiệm.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Bar: Key Slogan */}
      <div className="mt-4 pt-4 border-t border-gray-800 flex items-center justify-between text-xs text-gray-500 font-mono">
        <div>
          <span className="text-white font-bold">"LLM có thể bị lừa. Ngân sách trên Avalanche thì không."</span>
        </div>
        <div>
          <span>MissionPay · Avalanche Fuji</span>
        </div>
      </div>
    </div>
  );
}
