'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { verifyProof, VerificationResult } from '@/lib/proof-verifier';
import QRCodeDisplay from '@/components/QRCodeDisplay';
import { useI18n } from '@/lib/i18n';
import { Kicker, Stop } from '@/components/Display';

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

      // 1. Fail closed on unknown/missing chainId, and verify Avalanche Fuji (43113 / 0xa869)
      const expectedChainIdHex = '0xa869';
      let currentChainId = await ethereum.request({ method: 'eth_chainId' }).catch(() => null);
      if (!currentChainId) {
        throw new Error('Could not query chainId from wallet. Please ensure wallet is connected and unlocked.');
      }
      if (currentChainId.toLowerCase() !== expectedChainIdHex) {
        try {
          await ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: expectedChainIdHex }],
          });
        } catch (switchErr: any) {
          throw new Error(`Please switch wallet network to Avalanche Fuji Testnet (43113). Current: ${currentChainId}`);
        }
        currentChainId = await ethereum.request({ method: 'eth_chainId' }).catch(() => null);
        if (!currentChainId || currentChainId.toLowerCase() !== expectedChainIdHex) {
          throw new Error(`Wallet chain remains mismatched after switch attempt: expected ${expectedChainIdHex}, got ${currentChainId}`);
        }
      }

      const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
      if (!accounts || accounts.length === 0) {
        throw new Error('No active account returned from wallet.');
      }
      const currentAccount = accounts[0];
      const req = ercValidation.unsignedRequest;
      if (req.ownerAddress && currentAccount.toLowerCase() !== req.ownerAddress.toLowerCase()) {
        throw new Error(`Connected wallet (${currentAccount}) is not the mission owner (${req.ownerAddress})`);
      }

      // 2. Check for saved pending tx bound to chain+registry+requestHash+mission+owner to resume without double-sending
      const to = (req.to || '').toLowerCase();
      const reqHash = (req.requestHash || '').toLowerCase();
      const owner = (currentAccount || req.ownerAddress || '').toLowerCase();
      const pendingKey = `pending_validation_tx_43113_${to}_${reqHash}_${missionId}_${owner}`;
      let txHash = typeof window !== 'undefined' ? localStorage.getItem(pendingKey) : null;

      if (!txHash) {
        txHash = await ethereum.request({
          method: 'eth_sendTransaction',
          params: [
            {
              from: currentAccount,
              to: req.to,
              data: req.data,
              value: '0x0', // Strictly valid hex JSON-RPC quantity
            },
          ],
        });
        if (!txHash) throw new Error('Transaction submission failed');
        if (typeof window !== 'undefined') {
          localStorage.setItem(pendingKey, txHash);
        }
      }

      // 3. Wait boundedly for receipt before attempting reconciliation
      let receipt: any = null;
      const startTime = Date.now();
      while (Date.now() - startTime < 10_000) {
        try {
          receipt = await ethereum.request({
            method: 'eth_getTransactionReceipt',
            params: [txHash],
          });
          if (receipt) break;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }

      if (!receipt) {
        setWalletError(`Transaction ${txHash} submitted and pending on Avalanche Fuji. Receipt not yet mined. You can click to retry once mined without re-sending.`);
        return;
      }

      if (receipt.status === '0x0') {
        if (typeof window !== 'undefined') localStorage.removeItem(pendingKey);
        throw new Error(`ValidationRequest transaction reverted on-chain: ${txHash}`);
      }

      // 4. Authenticate POST reconciliation via stored owner Bearer read token OR fresh owner-signed server challenge
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const storedToken = typeof window !== 'undefined'
        ? (localStorage.getItem(`missionpay_owner_token_${missionId}`) ||
           localStorage.getItem('missionpay_owner_token') ||
           localStorage.getItem('token'))
        : null;

      let postBody: any = { txHash };

      if (storedToken) {
        headers['Authorization'] = `Bearer ${storedToken}`;
      } else {
        // Request server challenge with action RECONCILE_VALIDATION_REQUEST
        const challengeRes = await fetch('/api/auth/challenge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'RECONCILE_VALIDATION_REQUEST',
            expectedSigner: currentAccount,
            payload: {
              slug: missionId,
              txHash,
              chainId: 43113,
              registryAddress: req.to,
              ownerAddress: currentAccount,
              targetMissionSlug: missionId,
            },
          }),
        });
        const challengeData = await challengeRes.json();
        if (!challengeRes.ok || !challengeData.challenge) {
          throw new Error(challengeData.error || 'Failed to obtain reconciliation challenge');
        }

        const signature = await ethereum.request({
          method: 'personal_sign',
          params: [challengeData.challenge.message, currentAccount],
        });

        postBody = {
          txHash,
          nonce: challengeData.challenge.nonce,
          signature,
          payload: {
            slug: missionId,
            txHash,
            chainId: 43113,
            registryAddress: req.to,
            ownerAddress: currentAccount,
            targetMissionSlug: missionId,
          },
        };
      }

      const res = await fetch(`/api/verify/${missionId}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(postBody),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Reconciliation failed');
      }

      if (typeof window !== 'undefined') {
        localStorage.removeItem(pendingKey);
      }
      setReconcileSuccess(`Request submitted and reconciled on-chain! Tx: ${txHash}`);
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
      <div className="min-h-screen bg-paper text-ink p-4 sm:p-6 flex flex-col items-center justify-center text-center">
        <div className="outcome-blocked p-8 max-w-md space-y-4">
          <h1 className="font-display text-[28px] font-black uppercase leading-[.95] tracking-[-0.02em] text-ink"><Stop>{t('verify.not_found.title')}</Stop></h1>
          <p className="text-[15px] text-ink-2">
            {t('verify.not_found.desc')} ("{missionId}")
          </p>
          <div className="pt-2">
            <Link
              href="/verify/demo-seed"
              className="btn-dark min-h-[44px]"
            >
              {t('verify.not_found.cta')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper text-ink font-sans flex flex-col">
      {/* Hero band: slate */}
      <div className="hero-band hero-mint">
      <section className="hero-inner">
        <Kicker>{t('verify.tag')}</Kicker>

        <h1 className="display-h1 mb-5 max-w-[20ch]">
          <Stop>{t('verify.hero.title')}</Stop>
        </h1>

        <p className="lede">
          {t('verify.hero.desc')}
        </p>

        {/* Action Controls */}
        <div className="flex items-center gap-3 pt-6">
          {!isTampered ? (
            <button
              onClick={handleTamperOneByte}
              data-testid="tamper-one-byte-btn"
              className="btn-primary min-h-[44px] focus:outline-none focus:ring-2 focus:ring-ink"
            >
              <span>{t('verify.btn.tamper')}</span>
            </button>
          ) : (
            <button
              onClick={handleResetOriginal}
              data-testid="reset-original-btn"
              className="btn-ghost min-h-[44px] focus:outline-none focus:ring-2 focus:ring-ink"
            >
              <span>{t('verify.btn.reset')}</span>
            </button>
          )}
        </div>
      </section>
      </div>

      <div className="wrap pt-10 pb-14 space-y-6">
      {/* DEMO SEED Banner if in seed mode */}
      {isSeededDemo && (
        <div
          data-testid="demo-seed-banner"
          className="outcome-warn my-2 p-3 text-center font-bold text-warn text-sm"
        >
          DEMO SEED — NOT REAL TRANSACTIONS (Offline Auditorium Simulation)
        </div>
      )}

      {/* Main Status & QR Split Banner */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Verification Status Card */}
        <div
          className={`lg:col-span-3 rounded-data p-4 sm:p-6 border border-l-4 transition-all duration-300 ${
            verification.valid
              ? 'bg-paid-bg border-paid-rule border-l-paid'
              : 'bg-blocked-bg border-blocked-rule border-l-brand'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between mb-3 gap-2">
            <span className="text-sm font-semibold text-ink">
              {t('verify.result.title')}
            </span>
            <span
              className={` text-xs font-bold px-3 py-1 rounded-tag ${
                verification.valid
                  ? 'bg-paid-bg text-paid border border-paid-rule'
                  : 'bg-blocked-bg text-blocked border border-blocked-rule animate-pulse'
              }`}
            >
              {verification.valid ? t('verify.result.valid') : t('verify.result.invalid')}
            </span>
          </div>

          <div className="flex flex-col md:flex-row md:items-baseline justify-between gap-2">
            <div className="text-xl sm:text-2xl md:text-3xl font-bold tabular-nums">
              {verification.valid ? (
                <span className="text-paid">ALL ENTRIES MATCH CRYPTOGRAPHICALLY</span>
              ) : (
                <span className="text-blocked">HASH CHAIN CORRUPTION DETECTED</span>
              )}
            </div>
            <div className="text-xs text-ink-2">
              Total blocks: <span className="text-ink font-bold">{currentEntries.length}</span> entries
            </div>
          </div>

          {/* Anchor Status */}
          <div className="mt-4 pt-3 border-t border-rule flex flex-col space-y-2 text-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-ink-2">On-Chain Anchor Status:</span>
                <span
                  data-testid="anchor-status-badge"
                  className={`px-2.5 py-0.5 rounded-tag border font-bold ${
                    isHeadMatch
                      ? 'bg-paid-bg text-paid border-paid-rule'
                      : isHeadMismatch
                      ? 'bg-blocked-bg text-blocked border-blocked-rule'
                      : 'bg-warn-bg text-warn border-warn-rule'
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
                    className="bg-paid-bg text-paid border border-paid-rule px-2 py-0.5 rounded-tag text-[13px] font-bold"
                  >
                    MATCH
                  </span>
                )}
                {isHeadMismatch && (
                  <span
                    data-testid="anchor-mismatch-badge"
                    className="bg-blocked-bg text-blocked border border-blocked-rule px-2 py-0.5 rounded-tag text-[13px] font-bold"
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
                  className="link inline-flex items-center space-x-1 text-sm focus:outline-none focus:ring-1 focus:ring-ink"
                >
                  <span>View Anchor Tx on Snowtrace ↗</span>
                </a>
              )}
            </div>

            {/* Display on-chain head & client head when anchored */}
            {isAnchored && (
              <div className="bg-card border border-rule p-3 rounded-data grid grid-cols-1 md:grid-cols-2 gap-2 text-sm mt-2">
                <div>
                  <span className="text-ink-2 block text-[13px]">{t('verify.card.onchain_head')}:</span>
                  <span
                    data-testid="onchain-head"
                    className="font-mono text-ink break-all select-all font-bold"
                  >
                    {onchainHead}
                  </span>
                </div>
                <div>
                  <span className="text-ink-2 block text-[13px]">{t('verify.card.head')}:</span>
                  <span
                    data-testid="client-head"
                    className={`font-mono break-all select-all font-bold ${
                      isHeadMatch ? 'text-paid' : 'text-blocked'
                    }`}
                  >
                    {clientHead}
                  </span>
                </div>
              </div>
            )}

            <div className="text-xs text-ink-2">
              {anchorStatus?.note || 'Strict cryptographic verification against verified receipts.'}
            </div>
          </div>

          {/* ERC-8004 Independent Validation Card */}
          <div className="mt-4 pt-3 border-t border-rule flex flex-col space-y-2 text-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-ink-2">ERC-8004 Validation:</span>
                <span
                  data-testid="erc8004-status-badge"
                  className={`px-2.5 py-0.5 rounded-tag border font-bold ${
                    ercValidation?.isComplete
                      ? 'bg-paid-bg text-paid border-paid-rule'
                      : ercValidation?.status === 'REQUEST_PENDING'
                      ? 'bg-warn-bg text-warn border-warn-rule'
                      : ercValidation?.status === 'LOCAL_EVALUATED'
                      ? 'bg-tint-slate text-ink border-rule-2'
                      : ercValidation?.status === 'FAILED'
                      ? 'bg-blocked-bg text-blocked border-blocked-rule'
                      : 'bg-mist text-ink-2 border-rule'
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
                    className="bg-tint-slate text-ink border border-rule-2 px-2 py-0.5 rounded-tag text-[13px] font-bold"
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
                  className="link inline-flex items-center space-x-1 text-sm focus:outline-none focus:ring-1 focus:ring-ink"
                >
                  <span>Snowtrace Validation Response ↗</span>
                </a>
              )}
            </div>

            {(ercValidation?.isComplete || ercValidation?.status === 'LOCAL_EVALUATED') && (
              <div className="bg-card border border-rule p-3 rounded-data grid grid-cols-1 md:grid-cols-2 gap-2 text-sm mt-2">
                <div>
                  <span className="text-ink-2 block text-[13px]">Independent Validator EOA:</span>
                  <span
                    data-testid="erc8004-validator-address"
                    className="font-mono text-paid break-all select-all font-bold"
                  >
                    {ercValidation.validatorAddress}
                  </span>
                </div>
                <div>
                  <span className="text-ink-2 block text-[13px]">ERC-8004 Agent ID:</span>
                  <span
                    data-testid="erc8004-agent-id"
                    className="font-mono text-ink break-all select-all font-bold"
                  >
                    #{ercValidation.agentId || '294'}
                  </span>
                </div>
              </div>
            )}

            {ercValidation?.status === 'REQUEST_PENDING' && ercValidation?.unsignedRequest && (
              <div className="bg-warn-bg border border-warn-rule p-3 rounded-data space-y-2 text-xs mt-2" data-testid="owner-unsigned-request-box">
                <span className="font-bold text-warn block">Owner Action Required: Submit On-Chain Validation Request</span>
                <p className="text-ink-2 text-[13px]">
                  Backend does not hold owner private key. Sign this transaction with the mission owner wallet to request independent validator verification.
                </p>
                <div className="font-mono text-[13px] text-ink-2 bg-mist p-2 rounded-tag">
                  <div>Registry: <span className="text-warn">{ercValidation.unsignedRequest.to}</span></div>
                  <div>RequestHash: <span className="text-ink">{ercValidation.unsignedRequest.requestHash}</span></div>
                </div>
                <button
                  type="button"
                  data-testid="sign-validation-request-button"
                  onClick={handleOwnerSignAndBroadcast}
                  disabled={walletSubmitting}
                  className="w-full py-1.5 px-3 bg-warn hover:bg-warn disabled:opacity-50 text-white font-bold rounded-data text-xs transition-colors"
                >
                  {walletSubmitting ? 'Signing in Wallet...' : 'Sign & Broadcast Request via MetaMask'}
                </button>
                {walletError && (
                  <div className="text-blocked text-[13px] font-bold mt-1">{walletError}</div>
                )}
                {reconcileSuccess && (
                  <div className="text-paid text-[13px] font-bold mt-1">✓ {reconcileSuccess}</div>
                )}
              </div>
            )}
          </div>

          {/* Error messages if tampered */}
          {!verification.valid && (
            <div className="outcome-blocked mt-4 p-3 space-y-1 text-sm text-blocked">
              <span className="font-bold block text-blocked">{t('verify.tamper_alert')}</span>
              {verification.errors.map((err, i) => (
                <div key={i} className="text-xs">
                  • {err}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Audience QR Mobile Access */}
        <div className="bg-card border border-rule rounded-card p-5 flex flex-col items-center justify-between text-center space-y-3">
          <div>
            <span className="kick justify-center">
              OPEN ON MOBILE
            </span>
            <p className="text-sm text-ink-2 mb-3">
              Scan QR to test 1-byte modification on your personal device
            </p>

            <QRCodeDisplay
              url={verifyUrl || `http://localhost:3100/verify/${missionId}`}
              size={120}
              showUrlText={false}
            />
          </div>

          <span className="text-[13px] font-mono text-ink-2 break-all select-all mt-2 max-w-full">
            {verifyUrl || `/verify/${missionId}`}
          </span>
        </div>
      </div>

      </div>

      {/* Visual Hash Chain Timeline (proof band) */}
      <div className="redbar" aria-hidden="true" />
      <div className="band-navy">
      <div className="wrap band space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <h2 className="sec-h mb-0">
            <Stop>Keccak-256 Hash Chain Structure</Stop>
          </h2>
          <span className={isTampered ? 'tag-blocked self-start sm:self-auto' : 'tag-paid self-start sm:self-auto'}>
            {isTampered ? 'STATE: CORRUPTED DATA DETECTED' : 'STATE: INTEGRITY PRESERVED'}
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
                className={`p-4 rounded-data border border-l-4 transition-all duration-300 text-sm ${
                  isEntryTampered
                    ? 'bg-blocked-bg border-blocked-rule border-l-brand animate-pulse'
                    : isDownstreamBroken
                    ? 'bg-blocked-bg border-blocked-rule border-l-brand opacity-80'
                    : 'bg-paid-bg border-paid-rule border-l-paid'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex min-w-0 items-center space-x-2">
                    <span className="font-bold text-ink-2">Block #{idx}</span>
                    <span className="min-w-0 break-all bg-mist font-mono text-ink px-2 py-0.5 rounded-tag text-[13px]">
                      {entry.sourceKey}
                    </span>
                  </div>

                  <span
                    className={`text-[13px] font-bold px-2.5 py-0.5 rounded-tag ${
                      isEntryTampered
                        ? 'bg-blocked text-white'
                        : isDownstreamBroken
                        ? 'bg-blocked-bg text-blocked border border-blocked-rule'
                        : 'bg-paid-bg text-paid border border-paid-rule'
                    }`}
                  >
                    {isEntryTampered
                      ? '🛑 MODIFIED'
                      : isDownstreamBroken
                      ? 'CHAIN BROKEN'
                      : 'VERIFIED'}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-ink-2">
                  <div>
                    <span className="text-ink-2 block text-[13px]">prevHash:</span>
                    <span className="break-all block font-mono text-ink">{entry.prevHash}</span>
                  </div>
                  <div>
                    <span className="text-ink-2 block text-[13px]">entryHash:</span>
                    <span className="break-all block font-mono text-ink">{entry.entryHash}</span>
                  </div>
                </div>

                {/* Canonical payload summary */}
                <div className="mt-2 pt-2 border-t border-rule text-xs text-ink-2 break-all">
                  <span className="text-ink-2 mr-2">canonicalJson:</span>
                  <span className={isEntryTampered ? 'text-blocked font-bold' : 'text-ink'}>
                    {entry.canonicalJson}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      </div>

      {/* Footer */}
      <div className="wrap py-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-sm text-ink-2">
        <div>
          <span className="text-ink font-semibold">"Tamper 1 byte and the chain breaks. Cryptographically verifiable by anyone."</span>
        </div>
        <div>
          <span>MissionPay · Avalanche Fuji</span>
        </div>
      </div>
    </div>
  );
}
