import type { Metadata } from 'next';
import { Barlow_Condensed, Instrument_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const barlowCondensed = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-display',
  display: 'swap',
});

const instrumentSans = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-ui',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    template: '%s | RailGrid',
    default: 'RailGrid — Train Ticket Booking',
  },
  description:
    'Book train tickets across India. Search, select seats, and travel. Demo system — not affiliated with IRCTC or Indian Railways.',
  metadataBase: new URL(process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000'),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${barlowCondensed.variable} ${instrumentSans.variable} ${jetbrainsMono.variable} bg-ink text-chalk antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
