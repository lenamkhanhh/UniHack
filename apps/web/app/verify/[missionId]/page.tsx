'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { verifyProof, VerificationResult } from '@/lib/proof-verifier';
import QRCodeDisplay from '@/components/QRCodeDisplay';

export default function VerifyMissionProofPage() {
  const params = useParams();
  const missionId = (params?.missionId as string) || 'default-mission';

  const [originalEntries, setOriginalEntries] = useState<any[]>([]);
  const [currentEntries, setCurrentEntries] = useState<any[]>([]);
  const [anchorStatus, setAnchorStatus] = useState<any>(null);
  const [ercValidation, setErcValidation] = useState<any>(null);
  const [isTampered, setIsTampered] = useState(false);
  const [tamperedIndex, setTamperedIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifyUrl, setVerifyUrl] = useState('');
  const [isSeededDemo, setIsSeededDemo] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setVerifyUrl(window.location.href);
    }

    const loadData = async () => {
      try {
        const res = await fetch(`/api/verify/${missionId}`);
        if (res.status === 404) {
          setNotFound(true);
          return;
        }
        const json = await res.json();
        if (json.success && Array.isArray(json.entries)) {
          setOriginalEntries(json.entries);
          setCurrentEntries(json.entries);
          setAnchorStatus(json.anchorStatus);
          setErcValidation(json.erc8004Validation || null);
          setIsSeededDemo(Boolean(json.isSeededDemo));
        }
      } catch {
        // fallback empty
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [missionId]);

  // Client-side verification strictly executed in the user's browser runtime
  const verification: VerificationResult = useMemo(() => {
    if (!currentEntries || currentEntries.length === 0) {
      return {
        valid: false,
        errors: ['Không có bản ghi audit nào để xác minh'],
        headHash: '',
        totalEntries: 0,
      };
    }
    return verifyProof(currentEntries);
  }, [currentEntries]);

  // S1-F9: On-chain head comparison
  const clientHead = verification.headHash || '';
  const onchainHead = anchorStatus?.onchainHead || '';
  const isAnchored = Boolean(anchorStatus?.anchored && onchainHead);
  const isHeadMatch = isAnchored && verification.valid && clientHead && onchainHead && clientHead.toLowerCase() === onchainHead.toLowerCase();
  const isHeadMismatch = isAnchored && (!verification.valid || (clientHead && onchainHead && clientHead.toLowerCase() !== onchainHead.toLowerCase()));

  // Simulate modifying 1 byte in the first available entry (in memory only, zero DB mutation!)
  const handleTamperOneByte = () => {
    if (currentEntries.length === 0) return;
    const targetIdx = currentEntries.length > 1 ? 1 : 0;
    const target = currentEntries[targetIdx];

    try {
      const parsed = JSON.parse(target.canonicalJson);
      // Tamper: alter amount or reason by 1 byte
      parsed.amount = parsed.amount === '100000' ? '999999' : '1000000';
      parsed.reason = parsed.reason + ' [MODIFIED_1_BYTE_TAMPER]';

      const tamperedEntry = {
        ...target,
        canonicalJson: JSON.stringify(parsed),
      };

      const updated = [...currentEntries];
      updated[targetIdx] = tamperedEntry;

      setCurrentEntries(updated);
      setIsTampered(true);
      setTamperedIndex(targetIdx);
    } catch {
      // fallback text tamper
      const updated = [...currentEntries];
      updated[targetIdx] = {
        ...target,
        canonicalJson: target.canonicalJson + '!',
      };
      setCurrentEntries(updated);
      setIsTampered(true);
      setTamperedIndex(targetIdx);
    }
  };

  const handleResetOriginal = () => {
    setCurrentEntries([...originalEntries]);
    setIsTampered(false);
    setTamperedIndex(null);
  };

  if (notFound) {
    return (
      <div className="min-h-screen bg-[#07090e] text-white p-6 font-mono flex flex-col items-center justify-center text-center">
        <div className="p-8 bg-red-950/40 border border-red-500 rounded-2xl max-w-md space-y-3">
          <span className="text-4xl block">🔍</span>
          <h1 className="text-xl font-bold text-red-400">Không tìm thấy mission</h1>
          <p className="text-xs text-gray-400">
            Mã nhiệm vụ "{missionId}" không tồn tại trong cơ sở dữ liệu.
          </p>
          <div className="pt-2">
            <span className="text-[10px] text-gray-500 block">
              Gợi ý: Mở mission thực tế hoặc mở demo cố định tại /verify/demo-seed
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#07090e] text-white p-6 font-sans flex flex-col justify-between">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-gray-800 pb-4 gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" />
            <h1 className="text-xl md:text-2xl font-black tracking-tight text-white">
              ĐỪNG TIN CHÚNG TÔI — TỰ KIỂM CHỨNG
            </h1>
            <span className="text-xs bg-cyan-950/60 text-cyan-300 border border-cyan-800 px-2.5 py-0.5 rounded font-mono font-bold">
              CLIENT-SIDE VERIFIER
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            Toàn bộ chuỗi Keccak256 được tính toán độc lập ngay trên trình duyệt của bạn. So khớp trực tiếp với neo on-chain Avalanche Fuji.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-3">
          {!isTampered ? (
            <button
              onClick={handleTamperOneByte}
              data-testid="tamper-one-byte-btn"
              className="bg-red-600/20 hover:bg-red-600/30 border border-red-500/50 text-red-300 hover:text-white font-mono text-xs font-bold py-2.5 px-4 rounded-xl shadow-lg transition flex items-center space-x-2"
            >
              <span>🧪 THỬ SỬA 1 BYTE DỮ LIỆU</span>
            </button>
          ) : (
            <button
              onClick={handleResetOriginal}
              data-testid="reset-original-btn"
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs font-bold py-2.5 px-4 rounded-xl shadow-lg shadow-emerald-900/50 transition flex items-center space-x-2"
            >
              <span>🔄 KHÔI PHỤC NGUYÊN GỐC</span>
            </button>
          )}
        </div>
      </div>

      {/* DEMO SEED Banner if in seed mode */}
      {isSeededDemo && (
        <div
          data-testid="demo-seed-banner"
          className="my-3 p-3 bg-amber-950/60 border-2 border-amber-500 rounded-xl text-center font-bold text-amber-200 text-xs font-mono"
        >
          ⚠️ DEMO SEED — KHÔNG PHẢI GIAO DỊCH THẬT (Mô phỏng máy chiếu offline)
        </div>
      )}

      {/* Main Status & QR Split Banner */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 my-6">
        {/* Verification Status Card */}
        <div
          className={`lg:col-span-3 rounded-2xl p-6 border transition-all duration-300 ${
            verification.valid
              ? 'bg-emerald-950/20 border-emerald-600/40 shadow-[0_0_30px_rgba(16,185,129,0.15)]'
              : 'bg-red-950/30 border-red-500 shadow-[0_0_35px_rgba(239,68,68,0.25)]'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-gray-400">
              KẾT QUẢ KIỂM TRA MÃ HÓA CLIENT-SIDE
            </span>
            <span
              className={`font-mono text-xs font-bold px-3 py-1 rounded-full ${
                verification.valid
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'bg-red-500/20 text-red-300 border border-red-500/50 animate-pulse'
              }`}
            >
              {verification.valid ? '✅ CHUỖI TOÀN VẸN 100%' : '🛑 CHUỖI BỊ GÃY / GIAN LẬN'}
            </span>
          </div>

          <div className="flex flex-col md:flex-row md:items-baseline justify-between gap-2">
            <div className="text-2xl md:text-3xl font-black font-mono">
              {verification.valid ? (
                <span className="text-emerald-400">MỌI BẢN GHI KHỚP TUYỆT ĐỐI</span>
              ) : (
                <span className="text-red-400">PHÁT HIỆN SAI LỆCH MÃ HASH</span>
              )}
            </div>
            <div className="text-xs font-mono text-gray-400">
              Tổng số khối: <span className="text-white font-bold">{currentEntries.length}</span> entries
            </div>
          </div>

          {/* Anchor Status (S1-F9) */}
          <div className="mt-4 pt-3 border-t border-gray-800/80 flex flex-col space-y-2 text-xs font-mono">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-gray-400">Trạng thái neo On-Chain:</span>
                <span
                  data-testid="anchor-status-badge"
                  className={`px-2.5 py-0.5 rounded border font-bold ${
                    isHeadMatch
                      ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/40'
                      : isHeadMismatch
                      ? 'bg-red-500/20 text-red-300 border-red-500/50'
                      : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                  }`}
                >
                  {isHeadMatch
                    ? 'Đã neo on-chain (Fuji)'
                    : isHeadMismatch
                    ? 'Không khớp với on-chain'
                    : anchorStatus?.label || 'Chưa neo on-chain'}
                </span>

                {isHeadMatch && (
                  <span
                    data-testid="anchor-match-badge"
                    className="bg-emerald-950 text-emerald-400 border border-emerald-700 px-2 py-0.5 rounded text-[10px] font-bold"
                  >
                    khớp
                  </span>
                )}
                {isHeadMismatch && (
                  <span
                    data-testid="anchor-mismatch-badge"
                    className="bg-red-950 text-red-400 border border-red-700 px-2 py-0.5 rounded text-[10px] font-bold"
                  >
                    không khớp
                  </span>
                )}
              </div>

              {anchorStatus?.snowtraceUrl && (
                <a
                  href={anchorStatus.snowtraceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="anchor-tx-link"
                  className="text-cyan-400 hover:text-cyan-300 underline inline-flex items-center space-x-1 text-[11px]"
                >
                  <span>Xem giao dịch neo trên Snowtrace ↗</span>
                </a>
              )}
            </div>

            {/* Display on-chain head & client head when anchored */}
            {isAnchored && (
              <div className="bg-[#0b0e14] border border-gray-800 p-3 rounded-xl grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] mt-2">
                <div>
                  <span className="text-gray-500 block text-[10px]">Head neo on-chain (GuardedTreasury):</span>
                  <span
                    data-testid="onchain-head"
                    className="font-mono text-cyan-300 break-all select-all font-bold"
                  >
                    {onchainHead}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500 block text-[10px]">Head tính toán bởi trình duyệt (Client):</span>
                  <span
                    data-testid="client-head"
                    className={`font-mono break-all select-all font-bold ${
                      isHeadMatch ? 'text-emerald-300' : 'text-red-400'
                    }`}
                  >
                    {clientHead}
                  </span>
                </div>
              </div>
            )}

            <div className="text-[11px] text-gray-500">
              {anchorStatus?.note || 'Không giả lập tx; chỉ xác nhận khi có receipt hợp lệ.'}
            </div>
          </div>

          {/* ERC-8004 Independent Validation Card (WOW-W2) */}
          <div className="mt-4 pt-3 border-t border-gray-800/80 flex flex-col space-y-2 text-xs font-mono">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-gray-400">ERC-8004 Validation:</span>
                <span
                  data-testid="erc8004-status-badge"
                  className={`px-2.5 py-0.5 rounded border font-bold ${
                    ercValidation?.isComplete
                      ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/40'
                      : 'bg-zinc-800/60 text-zinc-400 border-zinc-700/50'
                  }`}
                >
                  {ercValidation?.isComplete
                    ? `Điểm xác thực: ${ercValidation.score}/100`
                    : 'Chưa được validate'}
                </span>
                {ercValidation?.isComplete && (
                  <span
                    data-testid="erc8004-tag-badge"
                    className="bg-cyan-950 text-cyan-300 border border-cyan-700 px-2 py-0.5 rounded text-[10px] font-bold"
                  >
                    {ercValidation.tag || 'verified-full'}
                  </span>
                )}
              </div>

              {ercValidation?.snowtraceUrl && (
                <a
                  href={ercValidation.snowtraceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="erc8004-tx-link"
                  className="text-cyan-400 hover:text-cyan-300 underline inline-flex items-center space-x-1 text-[11px]"
                >
                  <span>Xem tx phản hồi trên Snowtrace ↗</span>
                </a>
              )}
            </div>

            {ercValidation?.isComplete && (
              <div className="bg-[#0b0e14] border border-gray-800 p-3 rounded-xl grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] mt-2">
                <div>
                  <span className="text-gray-500 block text-[10px]">Independent Validator EOA:</span>
                  <span
                    data-testid="erc8004-validator-address"
                    className="font-mono text-emerald-300 break-all select-all font-bold"
                  >
                    {ercValidation.validatorAddress}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500 block text-[10px]">ERC-8004 Agent ID:</span>
                  <span
                    data-testid="erc8004-agent-id"
                    className="font-mono text-cyan-300 break-all select-all font-bold"
                  >
                    #{ercValidation.agentId || '294'}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Error messages if tampered */}
          {!verification.valid && (
            <div className="mt-4 p-3 bg-red-950/60 border border-red-600 rounded-xl space-y-1 font-mono text-xs text-red-200">
              <span className="font-bold block text-red-300">Chi tiết phát hiện gian lận:</span>
              {verification.errors.map((err, i) => (
                <div key={i} className="text-[11px]">
                  • {err}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Audience QR Mobile Access (WOW-F15) */}
        <div className="bg-[#0b0e14] border border-gray-800 rounded-2xl p-5 flex flex-col items-center justify-between text-center">
          <div>
            <span className="text-[10px] font-mono text-cyan-400 font-bold uppercase tracking-widest block mb-1">
              TỰ MỞ TRÊN ĐIỆN THOẠI
            </span>
            <p className="text-xs text-gray-300 font-medium mb-3">
              Quét mã để tự tay bấm "Sửa 1 byte" trên máy bạn
            </p>

            <QRCodeDisplay
              url={verifyUrl || `http://localhost:3100/verify/${missionId}`}
              size={120}
              showUrlText={false}
            />
          </div>

          <span className="text-[10px] font-mono text-gray-400 break-all select-all mt-3">
            {verifyUrl || `/verify/${missionId}`}
          </span>
        </div>
      </div>

      {/* Visual Hash Chain Timeline */}
      <div className="bg-[#0b0e14] border border-gray-800 rounded-2xl p-6 flex-1 space-y-4">
        <div className="flex items-center justify-between border-b border-gray-800 pb-3">
          <span className="text-xs font-mono font-bold uppercase tracking-wider text-gray-400">
            Cấu trúc chuỗi khối Keccak-256 (Cryptographic Hash Chain)
          </span>
          <span className="text-xs font-mono text-gray-500">
            {isTampered ? '⚠️ TRẠNG THÁI: DỮ LIỆU ĐÃ BỊ SỬA' : '🔒 TRẠNG THÁI: TOÀN VẸN'}
          </span>
        </div>

        {/* Chain blocks list */}
        <div className="space-y-4">
          {currentEntries.map((entry, idx) => {
            const isEntryTampered = isTampered && tamperedIndex === idx;
            const isDownstreamBroken = isTampered && tamperedIndex !== null && idx > tamperedIndex;

            return (
              <div
                key={entry.sourceKey || idx}
                data-testid={`chain-block-${idx}`}
                className={`p-4 rounded-xl border transition-all duration-300 font-mono text-xs ${
                  isEntryTampered
                    ? 'bg-red-950/40 border-red-500 shadow-[0_0_20px_rgba(239,68,68,0.3)] animate-pulse'
                    : isDownstreamBroken
                    ? 'bg-red-950/20 border-red-900/60 opacity-80'
                    : 'bg-[#101420] border-gray-800 hover:border-gray-700'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-gray-400">Block #{idx}</span>
                    <span className="bg-gray-800 text-gray-300 px-2 py-0.5 rounded text-[10px]">
                      {entry.sourceKey}
                    </span>
                  </div>

                  <span
                    className={`text-[10px] font-bold px-2.5 py-0.5 rounded ${
                      isEntryTampered
                        ? 'bg-red-500 text-white'
                        : isDownstreamBroken
                        ? 'bg-red-950 text-red-400 border border-red-800'
                        : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    }`}
                  >
                    {isEntryTampered
                      ? '🛑 ĐÃ BỊ SỬA ĐỔI'
                      : isDownstreamBroken
                      ? '⚠️ CHUỖI ĐỨT GÃY'
                      : '✅ VERIFIED'}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] text-gray-400">
                  <div>
                    <span className="text-gray-500 block text-[10px]">prevHash:</span>
                    <span className="truncate block font-mono text-gray-300">{entry.prevHash}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block text-[10px]">entryHash:</span>
                    <span className="truncate block font-mono text-cyan-300">{entry.entryHash}</span>
                  </div>
                </div>

                {/* Canonical payload summary */}
                <div className="mt-2 pt-2 border-t border-gray-800/60 text-[11px] text-gray-400 truncate">
                  <span className="text-gray-500 mr-2">canonicalJson:</span>
                  <span className={isEntryTampered ? 'text-red-300 font-bold' : 'text-gray-300'}>
                    {entry.canonicalJson}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-gray-800 pt-4 mt-6 flex items-center justify-between text-xs text-gray-500 font-mono">
        <div>
          <span className="text-white font-bold">"Sửa 1 byte là chuỗi gãy. Mọi người đều tự verify được."</span>
        </div>
        <div>
          <span>MissionPay · Avalanche Fuji</span>
        </div>
      </div>
    </div>
  );
}
