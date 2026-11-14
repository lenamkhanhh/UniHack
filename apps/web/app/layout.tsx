import type { Metadata } from 'next';
import { Archivo, Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { I18nProvider } from '@/lib/i18n';
import AppHeader from '@/components/AppHeader';

const geist = Geist({ subsets: ['latin', 'latin-ext'], variable: '--font-geist', display: 'swap' });
const geistMono = Geist_Mono({ subsets: ['latin', 'latin-ext'], variable: '--font-geist-mono', display: 'swap' });
// Display face for page h1 and section h2 only (Archivo 900, uppercase).
const archivo = Archivo({ weight: '900', subsets: ['latin', 'latin-ext', 'vietnamese'], variable: '--font-archivo', display: 'swap' });

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
    <html lang="en" className={`${geist.variable} ${geistMono.variable} ${archivo.variable}`}>
      <body className="bg-paper text-ink min-h-screen font-sans antialiased">
        <I18nProvider>
          <AppHeader paymentMode={paymentMode} stage={stage} />
          <main>{children}</main>
        </I18nProvider>
      </body>
    </html>
  );
}
