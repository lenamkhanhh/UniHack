import type { Metadata } from 'next';
import './globals.css';
import { I18nProvider } from '@/lib/i18n';
import AppHeader from '@/components/AppHeader';

export const metadata: Metadata = {
  title: 'MissionPay — Avalanche Fuji',
  description: 'MissionPay: Mission-Scoped Budget & Cryptographic Proofs on Avalanche Fuji',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const paymentMode = process.env.PAYMENT_MODE || 'MOCK';
  const stage = process.env.NEXT_PUBLIC_STAGE || 'S1';

  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100 min-h-screen antialiased">
        <I18nProvider>
          <AppHeader paymentMode={paymentMode} stage={stage} />
          <main className="p-4 md:p-6 max-w-7xl mx-auto">{children}</main>
        </I18nProvider>
      </body>
    </html>
  );
}
