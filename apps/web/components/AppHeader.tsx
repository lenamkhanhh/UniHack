'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useI18n } from '@/lib/i18n';

export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true" className="flex-none">
      <rect width="26" height="26" rx="7" fill="#E84142" />
      <path
        d="M7.5 13.5l3.6 3.6L18.7 9.5"
        fill="none"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
    <header className="relative z-10 border-b border-rule bg-paper">
      <div className="wrap flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3 lg:h-16 lg:py-0">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-tag text-lg font-bold tracking-[-0.02em] text-ink no-underline"
        >
          <BrandMark />
          <span>MissionPay</span>
        </Link>

        <nav
          aria-label="Main navigation"
          className="order-last -mx-1 flex w-full items-center gap-1 overflow-x-auto text-[15px] font-medium lg:order-none lg:mx-0 lg:ml-2 lg:w-auto lg:min-w-0 lg:flex-1"
        >
          {navLinks.map((link) => {
            const isActive = pathname === link.href || (link.href !== '/' && pathname?.startsWith(link.href));
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive ? 'page' : undefined}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 no-underline transition-colors ${
                  isActive ? 'bg-ink text-white' : 'text-ink-2 hover:bg-mist hover:text-ink'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-3">
          {/* Language Switcher */}
          <div
            className="inline-flex rounded-full border border-rule-2 bg-card p-0.5"
            role="group"
            aria-label="Language selection"
          >
            <button
              type="button"
              onClick={() => setLang('en')}
              aria-pressed={lang === 'en'}
              className={`rounded-full px-2.5 py-1 text-[13px] font-semibold transition-colors ${
                lang === 'en' ? 'bg-ink text-white' : 'text-ink-2 hover:text-ink'
              }`}
            >
              EN
            </button>
            <button
              type="button"
              onClick={() => setLang('vi')}
              aria-pressed={lang === 'vi'}
              className={`rounded-full px-2.5 py-1 text-[13px] font-semibold transition-colors ${
                lang === 'vi' ? 'bg-ink text-white' : 'text-ink-2 hover:text-ink'
              }`}
            >
              VI
            </button>
          </div>

          {/* Network & Mode Badges */}
          <div className="hidden items-center gap-1.5 sm:flex lg:hidden 2xl:flex">
            <span className={`${paymentMode === 'MOCK' ? 'tag-warn' : 'tag-info'} font-mono font-semibold`}>{paymentMode}</span>
            <span className="tag-neutral font-mono font-semibold">{stage}</span>
          </div>

          <Link href="/judge" className="btn-primary btn-sm btn-arrow hidden whitespace-nowrap md:inline-flex">
            Check it yourself
          </Link>
        </div>

      </div>
    </header>
  );
}
