'use client';

import React, { useState } from 'react';
import { useI18n } from '@/lib/i18n';

export default function BankrReplayPage() {
  const { lang } = useI18n();
  const tr = (vi: string, en: string) => (lang === 'vi' ? vi : en);
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
      setError(err.message || tr('Lỗi chạy replay Bankr', 'Failed to run the Bankr replay'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-night text-white p-6 font-sans flex flex-col justify-between">
      {/* Top Bar */}
      <div className="flex items-center justify-between border-b border-night-rule pb-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" />
            <h1 className="font-display text-[28px] font-black uppercase leading-none tracking-[-0.02em] text-white">
              {tr('REPLAY VỤ BANKR / GROK ($174k DRAIN)', 'BANKR / GROK REPLAY ($174k DRAIN)')}
            </h1>
            <span className="text-xs bg-rose-950/60 text-rose-300 border border-rose-800 px-2.5 py-0.5 rounded-tag font-mono font-bold">
              HISTORICAL INCIDENT • MAY 2026
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            {tr('"Tháng 5 năm 2026, kẻ tấn công dùng mã Morse trong bài đăng công khai để lừa AI Agent rút $174,000. Không ai lộ private key."', '"In May 2026, an attacker used Morse code in a public post to trick an AI Agent into withdrawing $174,000. No private key was leaked."')}
          </p>
        </div>

        <button
          onClick={handleRunReplay}
          disabled={loading}
          data-testid="run-bankr-replay-btn"
          className="bg-night-rule disabled:opacity-50 text-white font-bold py-3 px-6 rounded-full flex items-center space-x-2 transition text-sm font-mono tracking-wide"
        >
          {loading ? (
            <>
              <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <span>{tr('Đang tái hiện kịch bản...', 'Replaying the scenario...')}</span>
            </>
          ) : (
            <span>{tr('CHẠY LẠI VỤ BANKR $170k (30 GIÂY)', 'REPLAY BANKR $170k INCIDENT (30 SECONDS)')}</span>
          )}
        </button>
      </div>

      {error && (
        <div className="my-4 p-4 bg-red-950/40 border border-red-500 rounded-data text-sm text-red-200">
          {error}
        </div>
      )}

      {/* Main Content: Split Screen Comparison */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 my-6 flex-1">
        {/* Left Panel: Unguarded System (Mô phỏng không có guard) */}
        <div className="bg-night border border-red-900/40 rounded-2xl p-6 flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-red-600" />
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-mono font-bold bg-red-950/60 text-red-400 px-3 py-1 rounded-full border border-red-800">
                {tr('MÔ PHỎNG — HỆ KHÔNG CÓ GUARD', 'SIMULATION — SYSTEM WITHOUT A GUARD')}
              </span>
              <span className="text-[13px] font-mono text-gray-500">{tr('Kịch bản Bankr / Grok thật', 'Real Bankr / Grok scenario')}</span>
            </div>

            <h2 className="text-lg font-bold text-gray-200 mb-2">{tr('Ví AI Agent Hot Wallet truyền thống', 'Traditional AI Agent hot wallet')}</h2>
            <p className="text-xs text-gray-400 mb-6">
              {tr('Hệ thống coi kết quả suy luận của AI là thẩm quyền tài chính tối cao. Output của LLM được chuyển trực tiếp vào ví để ký chuyển tiền.', 'The system treats the AI reasoning output as the highest financial authority. LLM output goes straight into the wallet to sign transfers.')}
            </p>

            {/* Drained Balance Box */}
            <div className="bg-navy-2 border border-red-900/60 rounded-data p-5 mb-6 text-center space-y-2">
              <span className="text-xs font-mono text-gray-400 uppercase tracking-widest block">
                {tr('Số dư ví ban đầu ➔ Số dư sau đòn tấn công', 'Initial wallet balance ➔ Balance after the attack')}
              </span>
              <div className="flex items-center justify-center space-x-4">
                <span className="text-2xl font-mono text-gray-400 line-through">$174,000.00</span>
                <span className="text-3xl text-red-500 font-mono">➔</span>
                <span className={`text-5xl font-bold font-mono text-red-500 ${result ? 'animate-pulse' : ''}`}>
                  {result ? '$0.00' : '$174,000'}
                </span>
              </div>
              <span className="inline-block text-xs font-mono font-bold text-red-400 bg-red-950/60 px-3 py-1 rounded-full border border-red-800 mt-2">
                {result ? tr('TOÀN BỘ SỐ DƯ BỊ RÚT SẠCH', 'ENTIRE BALANCE DRAINED') : tr('Chờ chạy kịch bản...', 'Waiting to run the scenario...')}
              </span>
            </div>

            <div className="space-y-3 text-xs text-gray-400">
              <div className="flex items-center space-x-2">
                <span className="text-red-500 font-bold">✗</span>
                <span>{tr('Không có Allowlist kiểm tra địa chỉ nhận.', 'No allowlist checking the recipient address.')}</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-red-500 font-bold">✗</span>
                <span>{tr('Không có trần chi tiêu (Cap) khóa chặt theo từng nhiệm vụ.', 'No per-mission spending cap locked in.')}</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-red-500 font-bold">✗</span>
                <span>{tr('Guard chỉ nằm trong System Prompt của LLM nên bị thuyết phục.', 'The guard lives only in the LLM system prompt, so it can be talked out of it.')}</span>
              </div>
            </div>
          </div>

          <div className="text-[13px] text-gray-500 border-t border-night-rule pt-3 mt-6 font-mono text-center">
            {tr('MÔ PHỎNG CLIENT-SIDE • KHÔNG TẠO BẤT KỲ GIAO DỊCH HAY DỮ LIỆU DB NÀO', 'CLIENT-SIDE SIMULATION • CREATES NO TRANSACTION OR DB DATA')}
          </div>
        </div>

        {/* Right Panel: Our Guarded System on Avalanche */}
        <div className="bg-night border border-emerald-900/40 rounded-2xl p-6 flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500" />
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-mono font-bold bg-emerald-950/60 text-emerald-400 px-3 py-1 rounded-full border border-emerald-800">
                {tr('HỆ THỐNG MISSIONPAY (MÔ PHỎNG SANDBOX)', 'MISSIONPAY SYSTEM (SANDBOX SIMULATION)')}
              </span>
              <span className="text-[13px] font-mono text-gray-500">{tr('Lớp contract: chứng minh khi chạy Fuji', 'Contract layer: proven when run on Fuji')}</span>
            </div>

            <h2 className="text-lg font-bold text-gray-200 mb-2">{tr('GuardedTreasury + Ví phiên cô lập', 'GuardedTreasury + isolated session wallet')}</h2>
            <p className="text-xs text-gray-400 mb-6">
              {tr('"LLM có thể bị lừa. Ngân sách trên Avalanche thì không." Ngay cả khi LLM bị chiếm quyền hoàn toàn, validator và contract vẫn từ chối thực thi.', '"An LLM can be fooled. A budget on Avalanche cannot." Even when the LLM is fully hijacked, the validator and contract still refuse to execute.')}
            </p>

            {/* Preserved Balance Box */}
            <div className="bg-navy-2 border border-emerald-900/60 rounded-data p-5 mb-6 text-center space-y-2">
              <span className="text-xs font-mono text-gray-400 uppercase tracking-widest block">
                {tr('Thiệt hại tài chính thực tế', 'Actual financial loss')}
              </span>
              <div className="flex items-center justify-center space-x-2">
                <span className="text-6xl font-bold font-mono text-emerald-400">
                  $0.00
                </span>
              </div>
              <span className="inline-block text-xs font-mono font-bold text-emerald-300 bg-emerald-950/60 px-3 py-1 rounded-full border border-emerald-800 mt-2">
                {tr('Tiền đã chuyển: $0.00 — chặn bởi validator (off-chain)', 'Funds moved: $0.00 — blocked by the validator (off-chain)')}
              </span>
            </div>

            {/* Real-time Defense Status */}
            {result ? (
              <div className="space-y-3 bg-night p-4 rounded-data border border-night-rule text-xs font-mono">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">{tr('Trạng thái Agent (LLM):', 'Agent (LLM) status:')}</span>
                  <span className="text-amber-400 font-bold">{tr('ĐÃ BỊ THUYẾT PHỤC', 'CONVINCED')}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">{tr('Nguồn gốc người nhận:', 'Recipient provenance:')}</span>
                  <span className="text-rose-400 font-bold bg-rose-950/60 px-2 py-0.5 rounded-tag border border-rose-800 text-[13px]">
                    {result.validatorVerdict?.toProvenance ? `${tr('NGUỒN', 'SOURCE')}: ${result.validatorVerdict.toProvenance} ${tr('(DỮ LIỆU BẨN)', '(TAINTED DATA)')}` : `${tr('NGUỒN', 'SOURCE')}: WEB ${tr('(DỮ LIỆU BẨN)', '(TAINTED DATA)')}`}
                  </span>
                </div>
                <div className="flex flex-col space-y-1">
                  <span className="text-gray-400">Validator Guard:</span>
                  <span className="text-red-400 font-bold text-xs bg-red-950/40 p-2 rounded-tag border border-red-900/50">
                    {result.guardedSystem?.contractDefense || `Validator BLOCK ${result.validatorVerdict?.rule || 'RECIPIENT_NOT_ALLOWLISTED'} (off-chain) · ${tr('Lớp contract cap: sẽ chứng minh khi chạy Fuji live', 'Contract cap layer: will be proven on live Fuji')}`}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">{tr('Lý do bảo vệ:', 'Protection reason:')}</span>
                  <span className="text-gray-300 text-[13px]">{result.validatorVerdict?.reason}</span>
                </div>
                {result.guardedSystem?.auditEntryHash && (
                  <div className="flex items-center justify-between pt-2 border-t border-night-rule">
                    <span className="text-gray-400">Audit Ledger Hash:</span>
                    <span className="text-cyan-400 truncate max-w-[200px]">
                      {result.guardedSystem.auditEntryHash}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-4 bg-night rounded-data border border-night-rule text-center text-xs text-gray-500 font-mono">
                {tr('Bấm nút phía trên để kích hoạt đòn tấn công Morse và xem hệ thống phản ứng.', 'Press the button above to trigger the Morse attack and watch the system react.')}
              </div>
            )}
          </div>

          <div className="text-[13px] text-gray-500 border-t border-night-rule pt-3 mt-6 font-mono text-center">
            {tr('BẢO VỆ OFF-CHAIN BỞI VALIDATOR • LỚP CONTRACT CAP SẼ CHỨNG MINH KHI CHẠY FUJI LIVE', 'OFF-CHAIN PROTECTION BY THE VALIDATOR • CONTRACT CAP LAYER WILL BE PROVEN ON LIVE FUJI')}
          </div>
        </div>
      </div>

      {/* Decoded Morse Inspector Accordion */}
      {result?.attackFixture && (
        <div className="bg-night border border-night-rule rounded-data p-4 my-2 text-xs font-mono space-y-2">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-amber-400 font-bold">{tr('BẰNG CHỨNG ĐÒN TẤN CÔNG (ATTACK FIXTURE):', 'ATTACK EVIDENCE (ATTACK FIXTURE):')}</span>
            <span className="text-[13px] text-gray-500">{result.attackFixture.source}</span>
          </div>
          <div className="bg-navy-2 p-3 rounded-tag border border-night-rule text-amber-300">
            <span className="text-gray-500 block text-[13px]">{tr('Chuỗi mã Morse ẩn trong tài liệu nguồn:', 'Morse string hidden in the source document:')}</span>
            {result.attackFixture.rawMorse}
          </div>
          <div className="bg-navy-2 p-3 rounded-tag border border-night-rule text-rose-300">
            <span className="text-gray-500 block text-[13px]">{tr('Dòng lệnh sau khi Agent giải mã thành công:', 'Command line after the Agent decoded it:')}</span>
            {result.attackFixture.decodedMorse}
          </div>
        </div>
      )}

      {/* Bottom Slogan */}
      <div className="border-t border-night-rule pt-4 flex items-center justify-between text-xs text-gray-500 font-mono">
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
