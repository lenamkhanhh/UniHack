import type { Metadata } from 'next';
import './globals.css';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'MissionPay — Avalanche Fuji',
  description: 'MissionPay: Mission-Scoped Budget & Cryptographic Proofs on Avalanche Fuji',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-slate-900 text-slate-100 min-h-screen">
        <header className="border-b border-slate-800 bg-slate-950 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="font-bold text-lg text-emerald-400">
              MissionPay
            </Link>
            <nav className="flex gap-4 text-sm font-medium">
              <Link href="/" className="hover:text-emerald-400">
                Dashboard
              </Link>
              <Link href="/queue" className="hover:text-emerald-400">
                Queue (S2)
              </Link>
              <Link href="/audit" className="hover:text-emerald-400">
                Audit
              </Link>
              <Link href="/demo" className="hover:text-emerald-400">
                Demo
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 text-xs font-semibold rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
              MODE: {process.env.PAYMENT_MODE || 'MOCK'}
            </span>
            <span className="px-2.5 py-1 text-xs font-semibold rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
              STAGE: {process.env.NEXT_PUBLIC_STAGE || 'S1'}
            </span>
          </div>
        </header>
        <main className="p-6 max-w-7xl mx-auto">{children}</main>
      </body>
    </html>
  );
}
