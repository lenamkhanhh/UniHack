'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';
import AskContract from '@/components/AskContract';
import { Kicker, Stop } from '@/components/Display';

interface MissionSummary {
  slug: string;
  status: string;
  ownerAddress: string;
  agentAddress: string;
  expiresAt: string;
  payeeRoot?: string;
  payeeRootConfirmedOnchain?: boolean;
  toolCap?: string;
  spentTool?: string;
  reservedTool?: string;
  treasuryCap?: string;
  spentTreasury?: string;
  deliverableHash?: string;
}

const REPO = 'https://github.com/lenamkhanhh/UniHack';
const REPO_BLOB = `${REPO}/blob/feat/s1-app`;
const SNOWTRACE_TX = 'https://testnet.snowtrace.io/tx/';

const RESOURCE_LINKS = [
  { key: 'home.links.deck', href: `${REPO}/raw/feat/s1-app/artifacts/submission-s1/deck-v2/MissionPay_Deck_v2.pdf` },
  { key: 'home.links.video', href: `${REPO_BLOB}/artifacts/submission-s1/demo.mp4` },
  { key: 'home.links.code', href: REPO },
  { key: 'home.links.evidence', href: `${REPO_BLOB}/artifacts/submission-s1/FUJI_EVIDENCE.md` },
  { key: 'home.links.benchmark', href: `${REPO_BLOB}/eval/agentdojo/SUMMARY.md` },
];

function TxLink({ hash, dark = false }: { hash: string; dark?: boolean }) {
  return (
    <a
      href={`${SNOWTRACE_TX}${hash}`}
      target="_blank"
      rel="noreferrer"
      className={`font-mono text-[13px] underline underline-offset-2 ${dark ? 'text-[#A9C2F5] hover:text-white' : 'text-info hover:text-ink'}`}
    >
      {hash.slice(0, 10)}…{hash.slice(-4)}
    </a>
  );
}

function PasskeyIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" className="flex-none">
      <path
        d="M12 3a6 6 0 0 0-6 6v2M18 11V9a6 6 0 0 0-3-5.2M9 21c1.5-1.8 2-4 2-6.5V12a1 1 0 0 1 2 0v2.5c0 2.6-.6 5-2 7M6 15c0 2-.4 3.6-1.2 5M17.6 14c0 2.8-.5 5.2-1.6 7.2"
        fill="none"
        stroke="#fff"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

const compShadow = 'relative z-[1] bg-card shadow-[0_30px_60px_-28px_rgba(15,17,21,.55)] lg:absolute';
const compCard = `${compShadow} rounded-card`;
const compData = `${compShadow} rounded-data`;

export default function LandingPage() {
  const { t } = useI18n();
  const [missions, setMissions] = useState<MissionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMissions = () => {
    setLoading(true);
    setError(null);
    fetch('/api/missions')
      .then((res) => {
        if (!res.ok) throw new Error('Network response was not ok');
        return res.json();
      })
      .then((data) => {
        setMissions(data.missions || []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || 'Failed to load missions');
        setLoading(false);
      });
  };

  useEffect(() => {
    loadMissions();
  }, []);

  const twinRows = [
    {
      mission: 'twin.allowlist.v1',
      rule: t('home.twin.rule_allowlist'),
      paid: '0.01 USDC',
      outcome: <span className="tag bg-blocked-bg text-blocked">{t('home.twin.out_drained')}</span>,
      tx: '0x548d1106a69626eed32d308088f188c6d2d71d8e2f61e495f637d9f04e367fc6',
      hl: false,
    },
    {
      mission: 'twin.mission.v1',
      rule: t('home.twin.rule_mission'),
      paid: '0.00 USDC',
      outcome: <span className="tag bg-paid-bg text-paid">{t('home.twin.out_reverted')}</span>,
      tx: '0x0ad53adcf5790523e22219dcadc2c69b1a783d22c0bf651a9fa4742b43783e38',
      hl: true,
    },
    {
      mission: `twin.mission.v1 ${t('home.twin.control')}`,
      rule: t('home.twin.rule_control'),
      paid: t('home.twin.paid_control'),
      outcome: <span className="tag bg-navy-rule text-[#E9ECF2]">{t('home.twin.out_paid')}</span>,
      tx: '0xcb7236d146a2c8e2789db8ec2a80358b17d65993fc7b07187802e34c48656315',
      hl: false,
    },
  ];

  const resultRows: { n: number; source: React.ReactNode }[] = [
    { n: 1, source: <span className="font-mono text-[13px] text-ink-2">eval/agentdojo/SUMMARY.md</span> },
    { n: 2, source: <span className="font-mono text-[13px] text-ink-2">eval/agentdojo/SUMMARY.md</span> },
    { n: 3, source: <span className="font-mono text-[13px] text-ink-2">fuji_fork_replay.py</span> },
    { n: 4, source: <span className="font-mono text-[13px] text-ink-2">fuji_fork_replay.py</span> },
    { n: 5, source: <TxLink hash="0xa9f7faddb9e15f0efdb94349f49aed63a5af30666a9edeeffbb5fe8814af5ffa" /> },
    { n: 6, source: <span className="font-mono text-[13px] text-ink-2">contracts/test</span> },
  ];

  return (
    <div className="overflow-x-hidden">
      {/* Hero */}
      <div className="hero-band hero-paper">
      <section aria-labelledby="hero-heading" className="wrap grid items-center gap-10 pb-14 pt-8 lg:grid-cols-[.92fr_1.08fr] lg:pt-10">
        <div>
          <h1 id="hero-heading" className="display-h1 mb-5 lg:text-[64px]">
            <Stop>{t('home.hero.title_a')}</Stop> <Stop>{t('home.hero.title_b')}</Stop>
          </h1>
          <p className="lede mb-6 max-w-[46ch]">{t('home.hero.lede')}</p>
          <div className="mb-5 flex flex-wrap gap-2.5">
            <a href="#try" className="btn-primary btn-arrow">
              {t('home.cta.ask')}
            </a>
            <Link href="/bounty" className="btn-dark btn-arrow">
              {t('home.cta.bounty')}
            </Link>
          </div>
          <div className="flex flex-wrap gap-2">
            {RESOURCE_LINKS.map((l) => (
              <a
                key={l.key}
                href={l.href}
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-rule-2 bg-card px-3 py-1.5 font-mono text-[13px] font-medium uppercase tracking-[0.06em] text-ink no-underline hover:bg-mist"
              >
                {t(l.key)}
              </a>
            ))}
          </div>
        </div>

        <div
          role="img"
          aria-label={t('home.comp.aria')}
          className="relative flex flex-col gap-3.5 overflow-hidden rounded-[18px] bg-brand p-[18px] lg:block lg:h-[520px] lg:p-0"
        >
          <div aria-hidden="true" className="absolute -bottom-[120px] -right-20 h-[420px] w-[420px] rounded-full bg-brand-deep opacity-[.55]" />

          <div className={`${compCard} p-[18px] lg:left-6 lg:top-6 lg:w-[262px]`}>
            <div className="text-[13px] text-ink-3">{t('home.comp.mission_label')}</div>
            <h4 className="mb-2.5 mt-0.5 text-[18px] font-semibold">{t('home.comp.mission_title')}</h4>
            <div className="flex justify-between border-t border-rule py-[7px] text-sm">
              <span>{t('home.comp.budget')}</span>
              <span className="font-semibold tabular-nums">0.10 USDC</span>
            </div>
            <div className="flex justify-between border-t border-rule py-[7px] text-sm">
              <span>{t('home.comp.payees')}</span>
              <span className="font-semibold tabular-nums">{t('home.comp.payees_val')}</span>
            </div>
            <div className="mt-3 flex items-center gap-3 rounded-[10px] bg-ink px-3.5 py-3 text-[14.5px] font-semibold text-white">
              <PasskeyIcon />
              {t('home.comp.passkey')}
            </div>
          </div>

          <div className={`${compData} py-2 lg:bottom-[34px] lg:right-6 lg:w-[390px]`}>
            {[
              { title: t('home.comp.q1_title'), sub: t('home.comp.q1_sub'), tag: <span className="tag-paid">{t('home.comp.q1_tag')}</span> },
              { title: t('home.comp.q2_title'), sub: t('home.comp.q2_sub'), tag: <span className="tag-blocked">{t('home.comp.q2_tag')}</span> },
              { title: t('home.comp.q3_title'), sub: t('home.comp.q3_sub'), tag: <span className="tag-paid">{t('home.comp.q3_tag')}</span> },
            ].map((q, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto] items-center gap-2.5 border-b border-rule px-4 py-[11px] last:border-b-0">
                <div>
                  <b className="block text-[15px] font-semibold">{q.title}</b>
                  <small className="text-[13px] text-ink-3">{q.sub}</small>
                </div>
                {q.tag}
              </div>
            ))}
          </div>

          <div className={`${compData} border-l-4 border-brand px-[18px] py-4 lg:right-6 lg:top-6 lg:w-[272px]`}>
            <div className="text-base font-extrabold text-blocked">{t('home.comp.receipt_title')}</div>
            <div className="mt-0.5 text-[13px] text-ink-3">GuardedTreasury · proposeWithProof</div>
            <div className="mt-2.5 font-mono text-[13px] text-ink-2">
              PayeeNotInMissionSet
              <br />
              tx 0x0ad53adc…3e38
            </div>
          </div>

          <div className="relative z-[1] self-start rounded-full bg-brand-deep px-2.5 py-1 text-xs font-medium text-white lg:absolute lg:bottom-3 lg:left-6">{t('home.comp.note')}</div>
        </div>
      </section>
      </div>

      {/* Three objects */}
      <section className="bg-sand" aria-labelledby="objects-heading">
        <div className="wrap band">
          <Kicker>{t('home.objects.kick')}</Kicker>
          <h2 id="objects-heading" className="sec-h"><Stop>{t('home.objects.title')}</Stop></h2>
          <p className="sec-p">{t('home.objects.desc')}</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="overflow-hidden rounded-card border border-[#DDD5C6] bg-card">
              <div className="grid h-[168px] place-items-center bg-[#F7EBD3]">
                <div className="w-[220px] rounded-data bg-white p-3.5 text-[13px] shadow-[0_16px_30px_-18px_rgba(15,17,21,.5)]">
                  <b className="text-[13px]">{t('home.objects.doc_title')}</b>
                  <div className="flex justify-between border-b border-dashed border-rule py-[5px]"><span>{t('home.objects.doc_budget')}</span><span>0.10 USDC</span></div>
                  <div className="flex justify-between border-b border-dashed border-rule py-[5px]"><span>{t('home.objects.doc_payees')}</span><span>1</span></div>
                  <div className="flex justify-between py-[5px]"><span>{t('home.objects.doc_signer')}</span><span className="font-mono">0x4BC9…8F7c</span></div>
                  <div className="mt-2 rounded-data bg-paid-bg px-[7px] py-[5px] font-mono text-[13px] text-paid">root 0x3011ac81…71dd</div>
                </div>
              </div>
              <div className="px-5 pb-5 pt-[18px]">
                <h3 className="card-title mb-1.5">{t('home.objects.t1_title')}</h3>
                <p className="m-0 text-[15px] text-ink-2">{t('home.objects.t1_desc')}</p>
              </div>
            </div>
            <div className="overflow-hidden rounded-card border border-[#DDD5C6] bg-card">
              <div className="grid h-[168px] place-items-center bg-[#E5ECF6]">
                <div className="w-[220px] rounded-data bg-white p-3.5 text-xs shadow-[0_16px_30px_-18px_rgba(15,17,21,.5)]">
                  <span className="text-ink-3">{t('home.objects.prop_label')}</span>
                  <div className="mb-2 mt-0.5 text-[22px] font-extrabold">0.01 USDC</div>
                  <div className="rounded-data bg-chalk px-[7px] py-1.5 font-mono text-[13px] leading-[1.45] text-ink-2">
                    to 0x4BC9…8F7c
                    <br />
                    proof [ ] → root ✓
                  </div>
                </div>
              </div>
              <div className="px-5 pb-5 pt-[18px]">
                <h3 className="card-title mb-1.5">{t('home.objects.t2_title')}</h3>
                <p className="m-0 text-[15px] text-ink-2">{t('home.objects.t2_desc')}</p>
              </div>
            </div>
            <div className="overflow-hidden rounded-card border border-[#DDD5C6] bg-card">
              <div className="grid h-[168px] place-items-center bg-[#F6E1E1]">
                <div className="flex gap-2.5">
                  <div className="grid h-[120px] w-24 place-items-center rounded-[10px] bg-paid p-2 text-center text-[13px] font-extrabold text-white">
                    <div>PAY<small className="mt-1 block text-[13px] font-medium opacity-90">{t('home.objects.gate_ok_sub')}</small></div>
                  </div>
                  <div className="grid h-[120px] w-24 place-items-center rounded-[10px] bg-blocked p-2 text-center text-[13px] font-extrabold text-white">
                    <div>REVERT<small className="mt-1 block text-[13px] font-medium opacity-90">{t('home.objects.gate_no_sub')}</small></div>
                  </div>
                </div>
              </div>
              <div className="px-5 pb-5 pt-[18px]">
                <h3 className="card-title mb-1.5">{t('home.objects.t3_title')}</h3>
                <p className="m-0 text-[15px] text-ink-2">{t('home.objects.t3_desc')}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Table 1: twin treasury (dark band) */}
      <div className="redbar" aria-hidden="true" />
      <section className="band-navy" aria-labelledby="twin-heading">
        <div className="wrap band">
          <Kicker>{t('home.twin.kick')}</Kicker>
          <h2 id="twin-heading" className="sec-h"><Stop>{t('home.twin.title')}</Stop></h2>
          <p className="sec-p">{t('home.twin.desc')}</p>
          <figure className="tbl m-0">
            <div className="overflow-x-auto">
              <table className="min-w-[720px]">
                <thead>
                  <tr>
                    <th className="border-[#E9ECF2] text-[#B4BDCC]">{t('home.twin.th_mission')}</th>
                    <th className="border-[#E9ECF2] text-[#B4BDCC]">{t('home.twin.th_rule')}</th>
                    <th className="r border-[#E9ECF2] text-[#B4BDCC]">{t('home.twin.th_paid')}</th>
                    <th className="border-[#E9ECF2] text-[#B4BDCC]">{t('home.twin.th_outcome')}</th>
                    <th className="border-[#E9ECF2] text-[#B4BDCC]">{t('home.twin.th_tx')}</th>
                  </tr>
                </thead>
                <tbody>
                  {twinRows.map((r) => (
                    <tr key={r.mission} className={r.hl ? 'bg-navy-2' : undefined}>
                      <td className="border-navy-rule">{r.mission}</td>
                      <td className="border-navy-rule">{r.rule}</td>
                      <td className="r num border-navy-rule">{r.paid}</td>
                      <td className="border-navy-rule">{r.outcome}</td>
                      <td className="border-navy-rule"><TxLink hash={r.tx} dark /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <figcaption className="text-[#B4BDCC]">
              <b>Table 1.</b> {t('home.twin.caption')}
            </figcaption>
          </figure>
        </div>
      </section>

      {/* Ask the contract */}
      <section id="try" className="scroll-mt-4 bg-tint-rose" aria-label={t('home.try.title')}>
        <AskContract />
      </section>

      {/* Table 2: results + known limits */}
      <section className="bg-tint-slate" aria-labelledby="results-heading">
        <div className="wrap band">
          <Kicker>{t('home.results.kick')}</Kicker>
          <h2 id="results-heading" className="sec-h"><Stop>{t('home.results.title')}</Stop></h2>
          <p className="sec-p">{t('home.results.desc')}</p>
          <figure className="tbl m-0">
            <div className="overflow-x-auto">
              <table className="min-w-[720px]">
                <thead>
                  <tr>
                    <th className="border-[#1C2633]">{t('home.results.th_eval')}</th>
                    <th className="border-[#1C2633]">{t('home.results.th_setting')}</th>
                    <th className="r border-[#1C2633]">{t('home.results.th_result')}</th>
                    <th className="border-[#1C2633]">{t('home.results.th_source')}</th>
                  </tr>
                </thead>
                <tbody>
                  {resultRows.map((r) => (
                    <tr key={r.n}>
                      <td className="border-[#D2DAE4]">{t(`home.results.r${r.n}_eval`)}</td>
                      <td className="border-[#D2DAE4]">{t(`home.results.r${r.n}_setting`)}</td>
                      <td className="r num border-[#D2DAE4]">{t(`home.results.r${r.n}_result`)}</td>
                      <td className="border-[#D2DAE4]">{r.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <figcaption>
              <b>Table 2.</b> {t('home.results.caption')}
            </figcaption>
          </figure>
          <div className="mt-6 grid gap-5 rounded-card border-l-4 border-amber bg-card px-[22px] py-[18px] lg:grid-cols-[180px_1fr]">
            <h3 className="card-title">{t('home.limits.title')}</h3>
            <ul className="m-0 list-disc pl-[18px] text-ink-2">
              <li>{t('home.limits.l1')}</li>
              <li>{t('home.limits.l2')}</li>
              <li>{t('home.limits.l3')}</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Active Missions Dashboard Section */}
      <section aria-labelledby="active-missions-heading" className="wrap band space-y-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <h2 id="active-missions-heading" className="sec-h max-w-[30ch]">
              <Stop>{t('landing.section.missions')}</Stop>
            </h2>
            <p className="m-0 max-w-[60ch] text-base text-ink-2">{t('landing.section.missions_desc')}</p>
          </div>
          <button
            onClick={loadMissions}
            className="btn-ghost btn-sm self-start font-semibold sm:self-auto"
            aria-label="Refresh mission list"
          >
            {t('home.missions.refresh')}
          </button>
        </div>

        {loading ? (
          <div className="card py-16 text-center" role="status" aria-live="polite">
            <div className="mx-auto mb-3 h-7 w-7 animate-spin rounded-full border-2 border-ink border-t-transparent"></div>
            <p className="m-0 text-sm text-ink-2">{t('landing.loading')}</p>
          </div>
        ) : error ? (
          <div className="outcome-blocked p-6 text-center">
            <p className="mb-3 mt-0 text-sm font-semibold text-blocked">Error: {error}</p>
            <button onClick={loadMissions} className="btn-primary btn-sm font-semibold">
              Retry Connection
            </button>
          </div>
        ) : missions.length === 0 ? (
          <div className="card space-y-3 p-8 text-center">
            <p className="m-0 text-[15px] text-ink">{t('landing.empty.title')}</p>
            <p className="m-0 text-sm text-ink-2">{t('landing.empty.desc')}</p>
            <div className="flex flex-wrap justify-center gap-2.5 pt-2">
              <Link href="/demo" className="btn-primary btn-sm font-semibold">
                {t('landing.btn.demo')}
              </Link>
              <Link href="/bounty" className="btn-ghost btn-sm font-semibold">
                {t('landing.btn.bounty_cta')}
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {missions.map((m) => {
              const toolCap = BigInt(m.toolCap || '0');
              const spentTool = BigInt(m.spentTool || '0');
              const reservedTool = BigInt(m.reservedTool || '0');
              const toolRemaining = toolCap > spentTool + reservedTool ? toolCap - spentTool - reservedTool : 0n;

              const treasuryCap = BigInt(m.treasuryCap || '0');
              const spentTreasury = BigInt(m.spentTreasury || '0');
              const treasuryRemaining = treasuryCap > spentTreasury ? treasuryCap - spentTreasury : 0n;
              const treasuryOverBy = spentTreasury > treasuryCap ? spentTreasury - treasuryCap : 0n;

              return (
                <div key={m.slug} className="card space-y-4 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="max-w-[200px] truncate font-mono text-sm font-semibold text-ink sm:max-w-xs">
                      {m.slug}
                    </span>
                    <span className={m.status === 'ACTIVE' ? 'tag-paid' : 'tag-blocked'}>{m.status}</span>
                  </div>

                  <div className="space-y-1 text-sm text-ink-2">
                    <div className="truncate">Owner: <span className="font-mono">{m.ownerAddress}</span></div>
                    <div className="truncate">Agent: <span className="font-mono">{m.agentAddress}</span></div>
                    <div>Expires: {new Date(m.expiresAt).toLocaleString()}</div>
                    {m.payeeRoot && (
                      <div className="pt-1">
                        {m.payeeRootConfirmedOnchain ? (
                          <span data-testid="payee-root-onchain-badge" className="tag-paid">
                            {t('landing.card.payee_root_onchain')}: <span className="ml-1 font-mono font-medium">{m.payeeRoot.slice(0, 10)}...{m.payeeRoot.slice(-6)}</span>
                          </span>
                        ) : (
                          <span data-testid="payee-root-unconfirmed-badge" className="tag-warn">
                            {t('landing.card.payee_root_pending')}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Two Separate Budgets */}
                  <div className="grid grid-cols-2 gap-3 border-t border-rule pt-4">
                    <div className="rounded-data border border-rule bg-paper p-3">
                      <div className="text-xs font-medium text-ink-2">{t('landing.card.tool_budget')}</div>
                      <div className="mt-1 text-lg font-bold tabular-nums text-ink">
                        {(Number(toolRemaining) / 1e6).toFixed(2)} USDC
                      </div>
                      <div className="mt-1 space-y-0.5 text-xs tabular-nums text-ink-2">
                        <div>{t('landing.card.spent')}: {(Number(spentTool) / 1e6).toFixed(2)}</div>
                        <div>{t('landing.card.reserved')}: {(Number(reservedTool) / 1e6).toFixed(2)}</div>
                        <div>{t('landing.card.cap')}: {(Number(toolCap) / 1e6).toFixed(2)}</div>
                      </div>
                    </div>

                    <div className="rounded-data border border-rule bg-paper p-3">
                      <div className="text-xs font-medium text-ink-2">{t('landing.card.treasury_budget')}</div>
                      <div className="mt-1 text-lg font-bold tabular-nums text-ink">
                        {(Number(treasuryRemaining) / 1e6).toFixed(2)} USDC
                      </div>
                      <div className="mt-1 space-y-0.5 text-xs tabular-nums text-ink-2">
                        <div>{t('landing.card.cap')}: {(Number(treasuryCap) / 1e6).toFixed(2)}</div>
                        {treasuryOverBy > 0n && (
                          <div className="font-semibold text-warn">
                            {t('landing.card.over_by')}: {(Number(treasuryOverBy) / 1e6).toFixed(2)}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {m.deliverableHash && (
                    <div className="break-all rounded-data bg-paid-bg p-2.5 text-xs text-paid">
                      Deliverable Hash: <span className="font-mono">{m.deliverableHash}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-1 text-[13px]">
                    <Link href={`/verify/${m.slug}`} className="link font-medium">
                      {t('landing.card.view_proof')}
                    </Link>
                    {new Date() >= new Date(m.expiresAt) && (
                      <span className="text-ink-3">{t('landing.card.expired')}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <footer className="bg-navy py-7 pb-14 text-sm text-[#B4BDCC]">
        <div className="wrap">{t('home.footer')}</div>
      </footer>
    </div>
  );
}
