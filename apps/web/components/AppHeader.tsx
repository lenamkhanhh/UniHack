'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useI18n } from '@/lib/i18n';

export default function AppHeader({
  paymentMode = 'MOCK',
  stage = 'S1',
}: {
  paymentMode?: string;
  stage?: string;
}) {
  const { lang, setLang, t } = useI18n();
  const pathname = usePathname();

  const navLinks = [
    { href: '/', label: t('nav.dashboard') },
    { href: '/judge', label: t('nav.judge') },
    { href: '/bounty', label: t('nav.bounty') },
    { href: '/verify/demo-seed', label: t('nav.verify') },
    { href: '/missions/new', label: t('nav.passkey') },
    { href: '/arena/twin', label: 'Twin Treasury' },
    { href: '/demo', label: t('nav.demo') },
  ];

  return (
    <header className="border-b border-slate-800 bg-slate-950 px-4 md:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-4 md:gap-6 flex-wrap">
        <Link
          href="/"
          className="font-black text-lg md:text-xl text-emerald-400 tracking-tight flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-400 rounded px-1"
        >
          <span>🛡️</span>
          <span>MissionPay</span>
        </Link>
        <nav aria-label="Main navigation" className="flex items-center gap-2 md:gap-4 text-xs md:text-sm font-medium flex-wrap">
          {navLinks.map((link) => {
            const isActive = pathname === link.href || (link.href !== '/' && pathname?.startsWith(link.href));
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`px-2.5 py-1.5 rounded transition focus:outline-none focus:ring-2 focus:ring-emerald-400 ${
                  isActive
                    ? 'text-emerald-300 bg-emerald-950/60 font-semibold border border-emerald-800/80'
                    : 'text-slate-300 hover:text-white hover:bg-slate-900'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="flex items-center gap-3">
        {/* Language Switcher */}
        <div className="inline-flex rounded-lg bg-slate-900 p-0.5 border border-slate-800" role="group" aria-label="Language selection">
          <button
            type="button"
            onClick={() => setLang('en')}
            aria-pressed={lang === 'en'}
            className={`px-2.5 py-1 text-xs font-bold rounded-md transition focus:outline-none focus:ring-2 focus:ring-emerald-400 ${
              lang === 'en'
                ? 'bg-emerald-500 text-slate-950 shadow-sm'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            EN
          </button>
          <button
            type="button"
            onClick={() => setLang('vi')}
            aria-pressed={lang === 'vi'}
            className={`px-2.5 py-1 text-xs font-bold rounded-md transition focus:outline-none focus:ring-2 focus:ring-emerald-400 ${
              lang === 'vi'
                ? 'bg-emerald-500 text-slate-950 shadow-sm'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            VI
          </button>
        </div>

        {/* Network & Mode Badges */}
        <div className="hidden sm:flex items-center gap-2">
          <span className="px-2 py-0.5 text-[11px] font-mono font-semibold rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
            {paymentMode}
          </span>
          <span className="px-2 py-0.5 text-[11px] font-mono font-semibold rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
            {stage}
          </span>
        </div>
      </div>
    </header>
  );
}
