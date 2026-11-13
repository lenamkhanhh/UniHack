'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';

// Same read-only endpoint the /judge simulator uses (eth_call as the agent, 0.01 USDC, no gas).
const TREASURY_ADDRESS = '0x20451c1e2dCD83F166B4f22868BAdECb5868d545';
const AGENT_ADDRESS = '0x374b8A126FDb9e5deEc8307da385076155Af3D72';
const OWNER_ADDRESS = '0x4BC93356C180Ba2Dd13A4a1Cf43405Bd0eb58F7c';
const ATTACKER_VENDOR = '0xE90cf574D332658f9dfB950d899610Fb2F6e1aEA';
const DEFAULT_ADDRESS = '0x9b1E52D0f3a6C57e0aB0b4c1F2e4D7a8C3f6E091';
const AMOUNT_ATOMIC = 10000; // 0.01 USDC

type Answer =
  | { kind: 'idle' }
  | { kind: 'revert'; reason: string }
  | { kind: 'success' }
  | { kind: 'error'; message: string };

function randomAddress(): string {
  const hex = '0123456789abcdef';
  let a = '0x';
  for (let i = 0; i < 40; i++) a += hex[Math.floor(Math.random() * 16)];
  return a;
}

export default function AskContract() {
  const { t, lang } = useI18n();
  const [address, setAddress] = useState(DEFAULT_ADDRESS);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<Answer>({ kind: 'idle' });

  const check = async (target?: string) => {
    const recipient = (target ?? address).trim();
    if (!recipient) return;
    setBusy(true);
    try {
      const res = await fetch('/api/judge/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient, amountAtomic: AMOUNT_ATOMIC }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAnswer({ kind: 'error', message: (lang === 'vi' && data.messageVi) || data.message || `HTTP ${res.status}` });
        return;
      }
      const sim = data.simulation || data;
      if (sim.outcome === 'REVERT') setAnswer({ kind: 'revert', reason: sim.revertReason || 'Reverted' });
      else if (sim.outcome === 'SUCCESS') setAnswer({ kind: 'success' });
      else setAnswer({ kind: 'error', message: sim.details || sim.message || String(sim.outcome) });
    } catch (err: any) {
      setAnswer({ kind: 'error', message: err?.message || 'Network error' });
    } finally {
      setBusy(false);
    }
  };

  const pick = (addr: string) => {
    setAddress(addr);
    check(addr);
  };

  const castCmd = `cast call ${TREASURY_ADDRESS} "proposeWithProof(bytes32,address,uint256,bytes32,string,bytes32[])" … ${address || '0x…'} ${AMOUNT_ATOMIC} … --from ${AGENT_ADDRESS}`;

  const top =
    answer.kind === 'revert'
      ? { cls: 'bg-blocked text-white', title: t('home.try.no_title') }
      : answer.kind === 'success'
      ? { cls: 'bg-paid text-white', title: t('home.try.yes_title') }
      : answer.kind === 'error'
      ? { cls: 'bg-mist text-ink', title: t('home.try.err_title') }
      : { cls: 'bg-mist text-ink', title: t('home.try.idle_title') };

  return (
    <div className="wrap grid items-center gap-10 py-14 lg:grid-cols-2 lg:py-16">
      <div>
        <h2 className="sec-h">{t('home.try.title')}</h2>
        <p className="sec-p">{t('home.try.desc')}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            check();
          }}
        >
          <label htmlFor="ask-addr" className="mb-2 block text-sm font-semibold">
            {t('home.try.label')}
          </label>
          <div className="flex gap-2 rounded-full border border-[#E8C9C4] bg-card p-1.5 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink">
            <input
              id="ask-addr"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              className="min-w-0 flex-1 border-0 bg-transparent px-3.5 py-2.5 font-mono text-sm text-ink focus:outline-none"
            />
            <button type="submit" disabled={busy || !address.trim()} className="btn-primary font-semibold disabled:opacity-60">
              {busy ? t('home.try.checking') : t('home.try.check')}
            </button>
          </div>
        </form>
        <div className="mt-3.5 flex flex-wrap gap-2">
          {[
            { label: t('home.try.chip_random'), addr: () => randomAddress() },
            { label: t('home.try.chip_attacker'), addr: () => ATTACKER_VENDOR },
            { label: t('home.try.chip_owner'), addr: () => OWNER_ADDRESS },
          ].map((c) => (
            <button
              key={c.label}
              type="button"
              disabled={busy}
              onClick={() => pick(c.addr())}
              className="btn btn-sm border border-[#E8C9C4] bg-card font-semibold text-ink hover:bg-mist disabled:opacity-60"
            >
              {c.label}
            </button>
          ))}
        </div>
        <Link href="/judge" className="mt-5 inline-block text-sm text-ink-2 underline underline-offset-2 hover:text-ink">
          {t('home.try.full_judge')}
        </Link>
      </div>

      <div className="overflow-hidden rounded-2xl border border-rule bg-card" aria-live="polite" data-testid="home-ask-answer">
        <div className={`px-[22px] py-[18px] ${top.cls}`}>
          <b className="block text-[19px] font-semibold">{top.title}</b>
          <span className="text-[13.5px] opacity-90">{answer.kind === 'idle' ? t('home.try.idle_sub') : t('home.try.sub')}</span>
        </div>
        <dl className="m-0 grid grid-cols-[96px_1fr] gap-x-3.5 gap-y-2 px-5 py-4 text-[13.5px]">
          {answer.kind === 'revert' && (
            <>
              <dt className="text-ink-3">{t('home.try.dt_revert')}</dt>
              <dd className="m-0 font-mono">{answer.reason}</dd>
            </>
          )}
          {answer.kind === 'success' && (
            <>
              <dt className="text-ink-3">{t('home.try.dt_result')}</dt>
              <dd className="m-0">{t('home.try.accepted')}</dd>
            </>
          )}
          {answer.kind === 'error' && (
            <>
              <dt className="text-ink-3">{t('home.try.dt_result')}</dt>
              <dd className="m-0 break-words">{answer.message}</dd>
            </>
          )}
          <dt className="text-ink-3">{t('home.try.dt_contract')}</dt>
          <dd className="m-0 font-mono">GuardedTreasury 0x2045…d545</dd>
          <dt className="text-ink-3">{t('home.try.dt_mission')}</dt>
          <dd className="m-0 font-mono">twin.mission.v1</dd>
        </dl>
        <pre className="mx-[22px] mb-[22px] mt-0 whitespace-pre-wrap break-all rounded-lg bg-chalk px-3.5 py-3 font-mono text-xs leading-normal text-ink-2">
          {castCmd}
        </pre>
      </div>
    </div>
  );
}
