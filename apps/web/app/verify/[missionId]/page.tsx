'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { verifyProof, VerificationResult } from '@/lib/proof-verifier';
import QRCodeDisplay from '@/components/QRCodeDisplay';
import { useI18n } from '@/lib/i18n';

export default function VerifyMissionProofPage() {
  const { t } = useI18n();
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
  const [walletSubmitting, setWalletSubmitting] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [reconcileSuccess, setReconcileSuccess] = useState<string | null>(null);

  const handleOwnerSignAndBroadcast = async () => {
    if (!ercValidation?.unsignedRequest) return;
    setWalletSubmitting(true);
    setWalletError(null);
    try {
      if (typeof window === 'undefined' || !(window as any).ethereum) {
        throw new Error('No Web3 wallet (MetaMask) detected in browser.');
      }
      const ethereum = (window as any).ethereum;
      const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
      const currentAccount = accounts[0];
      const req = ercValidation.unsignedRequest;
      if (req.ownerAddress && currentAccount.toLowerCase() !== req.ownerAddress.toLowerCase()) {
        throw new Error(`Connected wallet (${currentAccount}) is not the mission owner (${req.ownerAddress})`);
      }
      const txHash = await ethereum.request({
        method: 'eth_sendTransaction',
        params: [
          {
            from: currentAccount,
            to: req.to,
            data: req.data,
            value: req.value || '0x0',
          },
        ],
      });
      const res = await fetch(`/api/verify/${missionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txHash }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Reconciliation failed');
      }
      setReconcileSuccess(`Request submitted on-chain! Tx: ${txHash}`);
      setTimeout(() => { window.location.reload(); }, 1500);
    } catch (err: any) {
      setWalletError(err?.message || 'Failed to submit validation request');
    } finally {
      setWalletSubmitting(false);
    }
  };

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
        errors: ['No audit log records available for verification'],
        headHash: '',
        totalEntries: 0,
      };
    }
    return verifyProof(currentEntries);
  }, [currentEntries]);

  // On-chain head comparison
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
      <div className="min-h-screen bg-slate-950 text-white p-4 sm:p-6 font-mono flex flex-col items-center justify-center text-center">
        <div className="p-8 bg-red-950/40 border border-red-500 rounded-2xl max-w-md space-y-4">
          <span className="text-4xl block" aria-hidden="true">🔍</span>
          <h1 className="text-xl font-bold text-red-300">{t('verify.not_found.title')}</h1>
          <p className="text-xs text-slate-300">
            {t('verify.not_found.desc')} ("{missionId}")
          </p>
          <div className="pt-2">
            <Link
              href="/verify/demo-seed"
              className="inline-block px-4 py-2 bg-slate-800 hover:bg-slate-700 text-emerald-300 rounded-lg text-xs font-bold border border-slate-700 transition focus:outline-none focus:ring-2 focus:ring-emerald-400 min-h-[44px] flex items-center justify-center"
            >
              {t('verify.not_found.cta')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 sm:p-6 font-sans flex flex-col justify-between space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-800 pb-4 gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" aria-hidden="true" />
            <h1 className="text-lg sm:text-2xl font-black tracking-tight text-white">
              {t('verify.hero.title')}
            </h1>
            <span className="text-xs bg-cyan-950/80 text-cyan-300 border border-cyan-800 px-2.5 py-0.5 rounded font-mono font-bold">
              {t('verify.tag')}
            </span>
          </div>
          <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed">
            {t('verify.hero.desc')}
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-3">
          {!isTampered ? (
            <button
              onClick={handleTamperOneByte}
              data-testid="tamper-one-byte-btn"
              className="bg-red-600/20 hover:bg-red-600/30 border border-red-500/60 text-red-200 hover:text-white font-mono text-xs font-bold py-2.5 px-4 rounded-xl shadow-lg transition flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-red-400 min-h-[44px]"
            >
              <span>{t('verify.btn.tamper')}</span>
            </button>
          ) : (
            <button
              onClick={handleResetOriginal}
              data-testid="reset-original-btn"
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs font-bold py-2.5 px-4 rounded-xl shadow-lg shadow-emerald-900/50 transition flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-emerald-400 min-h-[44px]"
            >
              <span>{t('verify.btn.reset')}</span>
            </button>
          )}
        </div>
      </div>

      {/* DEMO SEED Banner if in seed mode */}
      {isSeededDemo && (
        <div
          data-testid="demo-seed-banner"
          className="my-2 p-3 bg-amber-950/80 border-2 border-amber-500 rounded-xl text-center font-bold text-amber-200 text-xs font-mono"
        >
          ⚠️ DEMO SEED — NOT REAL TRANSACTIONS (Offline Auditorium Simulation)
        </div>
      )}

      {/* Main Status & QR Split Banner */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Verification Status Card */}
        <div
          className={`lg:col-span-3 rounded-2xl p-4 sm:p-6 border transition-all duration-300 ${
            verification.valid
              ? 'bg-emerald-950/20 border-emerald-600/40 shadow-[0_0_30px_rgba(16,185,129,0.15)]'
              : 'bg-red-950/30 border-red-500 shadow-[0_0_35px_rgba(239,68,68,0.25)]'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between mb-3 gap-2">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-300">
              {t('verify.result.title')}
            </span>
            <span
              className={`font-mono text-xs font-bold px-3 py-1 rounded-full ${
                verification.valid
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'bg-red-500/20 text-red-200 border border-red-500/50 animate-pulse'
              }`}
            >
              {verification.valid ? t('verify.result.valid') : t('verify.result.invalid')}
            </span>
          </div>

          <div className="flex flex-col md:flex-row md:items-baseline justify-between gap-2">
            <div className="text-xl sm:text-2xl md:text-3xl font-black font-mono">
              {verification.valid ? (
                <span className="text-emerald-400">ALL ENTRIES MATCH CRYPTOGRAPHICALLY</span>
              ) : (
                <span className="text-red-400">HASH CHAIN CORRUPTION DETECTED</span>
              )}
            </div>
            <div className="text-xs font-mono text-slate-300">
              Total blocks: <span className="text-white font-bold">{currentEntries.length}</span> entries
            </div>
          </div>

          {/* Anchor Status */}
          <div className="mt-4 pt-3 border-t border-slate-800 flex flex-col space-y-2 text-xs font-mono">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-slate-300">On-Chain Anchor Status:</span>
                <span
                  data-testid="anchor-status-badge"
                  className={`px-2.5 py-0.5 rounded border font-bold ${
                    isHeadMatch
                      ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/40'
                      : isHeadMismatch
                      ? 'bg-red-500/20 text-red-200 border-red-500/50'
                      : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                  }`}
                >
                  {isHeadMatch
                    ? 'Anchored on Avalanche Fuji'
                    : isHeadMismatch
                    ? 'Mismatch with On-Chain Anchor'
                    : anchorStatus?.label || t('verify.card.not_anchored')}
                </span>

                {isHeadMatch && (
                  <span
                    data-testid="anchor-match-badge"
                    className="bg-emerald-950 text-emerald-300 border border-emerald-700 px-2 py-0.5 rounded text-[10px] font-bold"
                  >
                    MATCH
                  </span>
                )}
                {isHeadMismatch && (
                  <span
                    data-testid="anchor-mismatch-badge"
                    className="bg-red-950 text-red-300 border border-red-700 px-2 py-0.5 rounded text-[10px] font-bold"
                  >
                    MISMATCH
                  </span>
                )}
              </div>

              {anchorStatus?.snowtraceUrl && (
                <a
                  href={anchorStatus.snowtraceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="anchor-tx-link"
                  className="text-cyan-400 hover:text-cyan-300 underline inline-flex items-center space-x-1 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-400"
                >
                  <span>View Anchor Tx on Snowtrace ↗</span>
                </a>
              )}
            </div>

            {/* Display on-chain head & client head when anchored */}
            {isAnchored && (
              <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl grid grid-cols-1 md:grid-cols-2 gap-2 text-xs mt-2">
                <div>
                  <span className="text-slate-300 block text-[10px]">{t('verify.card.onchain_head')}:</span>
                  <span
                    data-testid="onchain-head"
                    className="font-mono text-cyan-300 break-all select-all font-bold"
                  >
                    {onchainHead}
                  </span>
                </div>
                <div>
                  <span className="text-slate-300 block text-[10px]">{t('verify.card.head')}:</span>
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

            <div className="text-xs text-slate-300">
              {anchorStatus?.note || 'Strict cryptographic verification against verified receipts.'}
            </div>
          </div>

          {/* ERC-8004 Independent Validation Card */}
          <div className="mt-4 pt-3 border-t border-slate-800 flex flex-col space-y-2 text-xs font-mono">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-slate-300">ERC-8004 Validation:</span>
                <span
                  data-testid="erc8004-status-badge"
                  className={`px-2.5 py-0.5 rounded border font-bold ${
                    ercValidation?.isComplete
                      ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/40'
                      : ercValidation?.status === 'REQUEST_PENDING'
                      ? 'bg-amber-500/10 text-amber-300 border-amber-500/40'
                      : ercValidation?.status === 'LOCAL_EVALUATED'
                      ? 'bg-sky-500/10 text-sky-300 border-sky-500/40'
                      : ercValidation?.status === 'FAILED'
                      ? 'bg-red-500/10 text-red-300 border-red-500/40'
                      : 'bg-zinc-800/60 text-zinc-300 border-zinc-700/50'
                  }`}
                >
                  {ercValidation?.isComplete
                    ? `Validation Score: ${ercValidation.score}/100 (On-Chain Confirmed)`
                    : ercValidation?.status === 'LOCAL_EVALUATED'
                    ? `Local Evaluation: ${ercValidation.score}/100 (Snapshot Verified)`
                    : ercValidation?.status === 'REQUEST_PENDING'
                    ? 'Pending Owner On-Chain Request'
                    : ercValidation?.status === 'RESPONSE_PENDING'
                    ? 'Request On-Chain — Pending Validator Response'
                    : ercValidation?.status === 'FAILED'
                    ? `Validation Failed: ${ercValidation.failureReason || 'Error'}`
                    : 'Pending Post-Mission Validation'}
                </span>
                {(ercValidation?.isComplete || ercValidation?.status === 'LOCAL_EVALUATED') && (
                  <span
                    data-testid="erc8004-tag-badge"
                    className="bg-cyan-950 text-cyan-300 border border-cyan-700 px-2 py-0.5 rounded text-[10px] font-bold"
                  >
                    {ercValidation.tag || 'verified-full'}
                  </span>
                )}
              </div>

              {ercValidation?.isComplete && ercValidation?.snowtraceUrl && (
                <a
                  href={ercValidation.snowtraceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="erc8004-tx-link"
                  className="text-cyan-400 hover:text-cyan-300 underline inline-flex items-center space-x-1 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-400"
                >
                  <span>Snowtrace Validation Response ↗</span>
                </a>
              )}
            </div>

            {(ercValidation?.isComplete || ercValidation?.status === 'LOCAL_EVALUATED') && (
              <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl grid grid-cols-1 md:grid-cols-2 gap-2 text-xs mt-2">
                <div>
                  <span className="text-slate-300 block text-[10px]">Independent Validator EOA:</span>
                  <span
                    data-testid="erc8004-validator-address"
                    className="font-mono text-emerald-300 break-all select-all font-bold"
                  >
                    {ercValidation.validatorAddress}
                  </span>
                </div>
                <div>
                  <span className="text-slate-300 block text-[10px]">ERC-8004 Agent ID:</span>
                  <span
                    data-testid="erc8004-agent-id"
                    className="font-mono text-cyan-300 break-all select-all font-bold"
                  >
                    #{ercValidation.agentId || '294'}
                  </span>
                </div>
              </div>
            )}

            {ercValidation?.status === 'REQUEST_PENDING' && ercValidation?.unsignedRequest && (
              <div className="bg-amber-950/40 border border-amber-600/60 p-3 rounded-xl space-y-2 text-xs mt-2" data-testid="owner-unsigned-request-box">
                <span className="font-bold text-amber-300 block">Owner Action Required: Submit On-Chain Validation Request</span>
                <p className="text-slate-300 text-[11px]">
                  Backend does not hold owner private key. Sign this transaction with the mission owner wallet to request independent validator verification.
                </p>
                <div className="font-mono text-[10px] text-slate-300 bg-black/40 p-2 rounded">
                  <div>Registry: <span className="text-amber-200">{ercValidation.unsignedRequest.to}</span></div>
                  <div>RequestHash: <span className="text-cyan-200">{ercValidation.unsignedRequest.requestHash}</span></div>
                </div>
                <button
                  type="button"
                  data-testid="sign-validation-request-button"
                  onClick={handleOwnerSignAndBroadcast}
                  disabled={walletSubmitting}
                  className="w-full py-1.5 px-3 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-black font-bold rounded-lg text-xs transition-colors"
                >
                  {walletSubmitting ? 'Signing in Wallet...' : 'Sign & Broadcast Request via MetaMask'}
                </button>
                {walletError && (
                  <div className="text-red-400 text-[11px] font-bold mt-1">⚠️ {walletError}</div>
                )}
                {reconcileSuccess && (
                  <div className="text-emerald-400 text-[11px] font-bold mt-1">✓ {reconcileSuccess}</div>
                )}
              </div>
            )}
          </div>

          {/* Error messages if tampered */}
          {!verification.valid && (
            <div className="mt-4 p-3 bg-red-950/60 border border-red-600 rounded-xl space-y-1 font-mono text-xs text-red-200">
              <span className="font-bold block text-red-300">{t('verify.tamper_alert')}</span>
              {verification.errors.map((err, i) => (
                <div key={i} className="text-xs">
                  • {err}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Audience QR Mobile Access */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col items-center justify-between text-center space-y-3">
          <div>
            <span className="text-[10px] font-mono text-cyan-400 font-bold uppercase tracking-widest block mb-1">
              OPEN ON MOBILE
            </span>
            <p className="text-xs text-slate-300 font-medium mb-3">
              Scan QR to test 1-byte modification on your personal device
            </p>

            <QRCodeDisplay
              url={verifyUrl || `http://localhost:3100/verify/${missionId}`}
              size={120}
              showUrlText={false}
            />
          </div>

          <span className="text-[10px] font-mono text-slate-300 break-all select-all mt-2 max-w-full">
            {verifyUrl || `/verify/${missionId}`}
          </span>
        </div>
      </div>

      {/* Visual Hash Chain Timeline */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 flex-1 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800 pb-3 gap-1">
          <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-300">
            Keccak-256 Hash Chain Structure
          </span>
          <span className="text-xs font-mono text-slate-300">
            {isTampered ? '⚠️ STATE: CORRUPTED DATA DETECTED' : '🔒 STATE: INTEGRITY PRESERVED'}
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
                    : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-slate-300">Block #{idx}</span>
                    <span className="bg-slate-800 text-slate-200 px-2 py-0.5 rounded text-[10px]">
                      {entry.sourceKey}
                    </span>
                  </div>

                  <span
                    className={`text-[10px] font-bold px-2.5 py-0.5 rounded ${
                      isEntryTampered
                        ? 'bg-red-500 text-white'
                        : isDownstreamBroken
                        ? 'bg-red-950 text-red-300 border border-red-800'
                        : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    }`}
                  >
                    {isEntryTampered
                      ? '🛑 MODIFIED'
                      : isDownstreamBroken
                      ? '⚠️ CHAIN BROKEN'
                      : '✅ VERIFIED'}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-slate-300">
                  <div>
                    <span className="text-slate-400 block text-[10px]">prevHash:</span>
                    <span className="break-all block font-mono text-slate-200">{entry.prevHash}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">entryHash:</span>
                    <span className="break-all block font-mono text-cyan-300">{entry.entryHash}</span>
                  </div>
                </div>

                {/* Canonical payload summary */}
                <div className="mt-2 pt-2 border-t border-slate-800/80 text-xs text-slate-300 break-all">
                  <span className="text-slate-400 mr-2">canonicalJson:</span>
                  <span className={isEntryTampered ? 'text-red-300 font-bold' : 'text-slate-200'}>
                    {entry.canonicalJson}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-slate-800 pt-4 mt-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-400 font-mono">
        <div>
          <span className="text-white font-semibold">"Tamper 1 byte and the chain breaks. Cryptographically verifiable by anyone."</span>
        </div>
        <div>
          <span>MissionPay · Avalanche Fuji</span>
        </div>
      </div>
    </div>
  );
}
