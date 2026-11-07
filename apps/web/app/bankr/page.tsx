'use client';

import React, { useState } from 'react';

export default function BankrReplayPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRunReplay = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/bankr-replay', {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setResult(data.replay);
    } catch (err: any) {
      setError(err.message || 'Lỗi chạy replay Bankr');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#07090e] text-white p-6 font-sans flex flex-col justify-between">
      {/* Top Bar */}
      <div className="flex items-center justify-between border-b border-gray-800 pb-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" />
            <h1 className="text-2xl font-black tracking-tight text-white">
              REPLAY VỤ BANKR / GROK ($174k DRAIN)
            </h1>
            <span className="text-xs bg-rose-950/60 text-rose-300 border border-rose-800 px-2.5 py-0.5 rounded font-mono font-bold">
              HISTORICAL INCIDENT • MAY 2026
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            "Tháng 5 năm 2026, kẻ tấn công dùng mã Morse trong bài đăng công khai để lừa AI Agent rút $174,000. Không ai lộ private key."
          </p>
        </div>

        <button
          onClick={handleRunReplay}
          disabled={loading}
          data-testid="run-bankr-replay-btn"
          className="bg-gradient-to-r from-red-600 to-rose-700 hover:from-red-500 hover:to-rose-600 disabled:opacity-50 text-white font-bold py-3 px-6 rounded-xl shadow-lg shadow-red-950/50 flex items-center space-x-2 transition text-sm font-mono tracking-wide"
        >
          {loading ? (
            <>
              <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <span>Đang tái hiện kịch bản...</span>
            </>
          ) : (
            <span>⚡ CHẠY LẠI VỤ BANKR $170k (30 GIÂY)</span>
          )}
        </button>
      </div>

      {error && (
        <div className="my-4 p-4 bg-red-950/40 border border-red-500 rounded-lg text-sm text-red-200">
          {error}
        </div>
      )}

      {/* Main Content: Split Screen Comparison */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 my-6 flex-1">
        {/* Left Panel: Unguarded System (Mô phỏng không có guard) */}
        <div className="bg-[#0b0e14] border border-red-900/40 rounded-2xl p-6 flex flex-col justify-between shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-red-600" />
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-mono font-bold bg-red-950/60 text-red-400 px-3 py-1 rounded-full border border-red-800">
                MÔ PHỎNG — HỆ KHÔNG CÓ GUARD
              </span>
              <span className="text-[11px] font-mono text-gray-500">Kịch bản Bankr / Grok thật</span>
            </div>

            <h2 className="text-lg font-bold text-gray-200 mb-2">Ví AI Agent Hot Wallet truyền thống</h2>
            <p className="text-xs text-gray-400 mb-6">
              Hệ thống coi kết quả suy luận của AI là thẩm quyền tài chính tối cao. Output của LLM được chuyển trực tiếp vào ví để ký chuyển tiền.
            </p>

            {/* Drained Balance Box */}
            <div className="bg-[#131722] border border-red-900/60 rounded-xl p-5 mb-6 text-center space-y-2">
              <span className="text-xs font-mono text-gray-400 uppercase tracking-widest block">
                Số dư ví ban đầu ➔ Số dư sau đòn tấn công
              </span>
              <div className="flex items-center justify-center space-x-4">
                <span className="text-2xl font-mono text-gray-400 line-through">$174,000.00</span>
                <span className="text-3xl text-red-500 font-mono">➔</span>
                <span className={`text-5xl font-black font-mono text-red-500 ${result ? 'animate-pulse' : ''}`}>
                  {result ? '$0.00' : '$174,000'}
                </span>
              </div>
              <span className="inline-block text-xs font-mono font-bold text-red-400 bg-red-950/60 px-3 py-1 rounded-full border border-red-800 mt-2">
                {result ? '💸 TOÀN BỘ SỐ DƯ BỊ RÚT SẠCH' : 'Chờ chạy kịch bản...'}
              </span>
            </div>

            <div className="space-y-3 text-xs text-gray-400">
              <div className="flex items-center space-x-2">
                <span className="text-red-500 font-bold">❌</span>
                <span>Không có Allowlist kiểm tra địa chỉ nhận.</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-red-500 font-bold">❌</span>
                <span>Không có trần chi tiêu (Cap) khóa chặt theo từng nhiệm vụ.</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-red-500 font-bold">❌</span>
                <span>Guard chỉ nằm trong System Prompt của LLM nên bị thuyết phục.</span>
              </div>
            </div>
          </div>

          <div className="text-[10px] text-gray-500 border-t border-gray-900 pt-3 mt-6 font-mono text-center">
            MÔ PHỎNG CLIENT-SIDE • KHÔNG TẠO BẤT KỲ GIAO DỊCH HAY DỮ LIỆU DB NÀO
          </div>
        </div>

        {/* Right Panel: Our Guarded System on Avalanche */}
        <div className="bg-[#0b0e14] border border-emerald-900/40 rounded-2xl p-6 flex flex-col justify-between shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500" />
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-mono font-bold bg-emerald-950/60 text-emerald-400 px-3 py-1 rounded-full border border-emerald-800">
                HỆ THỐNG MISSIONPAY (MÔ PHỎNG SANDBOX)
              </span>
              <span className="text-[11px] font-mono text-gray-500">Lớp contract: chứng minh khi chạy Fuji</span>
            </div>

            <h2 className="text-lg font-bold text-gray-200 mb-2">GuardedTreasury + Ví phiên cô lập</h2>
            <p className="text-xs text-gray-400 mb-6">
              "LLM có thể bị lừa. Ngân sách trên Avalanche thì không." Ngay cả khi LLM bị chiếm quyền hoàn toàn, validator và contract vẫn từ chối thực thi.
            </p>

            {/* Preserved Balance Box */}
            <div className="bg-[#131722] border border-emerald-900/60 rounded-xl p-5 mb-6 text-center space-y-2">
              <span className="text-xs font-mono text-gray-400 uppercase tracking-widest block">
                Thiệt hại tài chính thực tế
              </span>
              <div className="flex items-center justify-center space-x-2">
                <span className="text-6xl font-black font-mono text-emerald-400 drop-shadow-[0_0_20px_rgba(52,211,153,0.3)]">
                  $0.00
                </span>
              </div>
              <span className="inline-block text-xs font-mono font-bold text-emerald-300 bg-emerald-950/60 px-3 py-1 rounded-full border border-emerald-800 mt-2">
                Tiền đã chuyển: $0.00 — chặn bởi validator (off-chain)
              </span>
            </div>

            {/* Real-time Defense Status */}
            {result ? (
              <div className="space-y-3 bg-[#0d121c] p-4 rounded-xl border border-gray-800 text-xs font-mono">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Trạng thái Agent (LLM):</span>
                  <span className="text-amber-400 font-bold">🧠 ĐÃ BỊ THUYẾT PHỤC ✅</span>
                </div>
                <div className="flex flex-col space-y-1">
                  <span className="text-gray-400">Validator Guard:</span>
                  <span className="text-red-400 font-bold text-xs bg-red-950/40 p-2 rounded border border-red-900/50">
                    {result.guardedSystem?.contractDefense || `🛡️ Validator BLOCK ${result.validatorVerdict?.rule || 'RECIPIENT_NOT_ALLOWLISTED'} (off-chain) · Lớp contract cap: sẽ chứng minh khi chạy Fuji live`}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Lý do bảo vệ:</span>
                  <span className="text-gray-300 text-[11px]">{result.validatorVerdict?.reason}</span>
                </div>
                {result.guardedSystem?.auditEntryHash && (
                  <div className="flex items-center justify-between pt-2 border-t border-gray-800">
                    <span className="text-gray-400">Audit Ledger Hash:</span>
                    <span className="text-cyan-400 truncate max-w-[200px]">
                      {result.guardedSystem.auditEntryHash}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-4 bg-[#0d121c] rounded-xl border border-gray-800 text-center text-xs text-gray-500 font-mono">
                Bấm nút phía trên để kích hoạt đòn tấn công Morse và xem hệ thống phản ứng.
              </div>
            )}
          </div>

          <div className="text-[10px] text-gray-500 border-t border-gray-900 pt-3 mt-6 font-mono text-center">
            BẢO VỆ OFF-CHAIN BỞI VALIDATOR • LỚP CONTRACT CAP SẼ CHỨNG MINH KHI CHẠY FUJI LIVE
          </div>
        </div>
      </div>

      {/* Decoded Morse Inspector Accordion */}
      {result?.attackFixture && (
        <div className="bg-[#0c1018] border border-gray-800 rounded-xl p-4 my-2 text-xs font-mono space-y-2">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-amber-400 font-bold">📻 BẰNG CHỨNG ĐÒN TẤN CÔNG (ATTACK FIXTURE):</span>
            <span className="text-[11px] text-gray-500">{result.attackFixture.source}</span>
          </div>
          <div className="bg-[#121724] p-3 rounded border border-gray-800 text-amber-300">
            <span className="text-gray-500 block text-[10px]">Chuỗi mã Morse ẩn trong tài liệu nguồn:</span>
            {result.attackFixture.rawMorse}
          </div>
          <div className="bg-[#121724] p-3 rounded border border-gray-800 text-rose-300">
            <span className="text-gray-500 block text-[10px]">Dòng lệnh sau khi Agent giải mã thành công:</span>
            {result.attackFixture.decodedMorse}
          </div>
        </div>
      )}

      {/* Bottom Slogan */}
      <div className="border-t border-gray-800 pt-4 flex items-center justify-between text-xs text-gray-500 font-mono">
        <div>
          <span className="text-white font-bold">"LLM có thể bị lừa. Ngân sách trên Avalanche thì không."</span>
        </div>
        <div>
          <span>AVALANCHE FUJI • UNIHAX STAGE CONSOLE</span>
        </div>
      </div>
    </div>
  );
}
