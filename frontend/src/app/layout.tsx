import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { AuthProvider } from '@/lib/hooks/useAuth';
import { ThemeProvider } from '@/lib/hooks/useTheme';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://nexlify.app';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Nexlify — אוטומציית שיווק שותפים מבוססת AI',
    template: '%s · Nexlify',
  },
  description:
    'Nexlify — מנוע שיווק השותפים שעושה הכל: גילוי מוצרים מ-AliExpress, כתיבת קופי עם AI, פרסום רב-ערוצי (טלגרם + פייסבוק), וקידום אוטומטי לפי ROAS.',
  applicationName: 'Nexlify',
  openGraph: {
    type: 'website',
    siteName: 'Nexlify',
    locale: 'he_IL',
    title: 'Nexlify — אוטומציית שיווק שותפים מבוססת AI',
    description: 'גילוי מוצרים, קופי עם AI, פרסום רב-ערוצי, וקידום אוטומטי לפי ROAS — מערכת אחת.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Nexlify — אוטומציית שיווק שותפים מבוססת AI',
    description: 'גילוי מוצרים, קופי עם AI, פרסום רב-ערוצי, וקידום אוטומטי לפי ROAS — מערכת אחת.',
  },
};

const ORG_JSONLD = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Nexlify',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  description:
    'All-in-one AI affiliate marketing automation: AliExpress product discovery, AI copywriting, multi-channel publishing (Telegram + Facebook), and ROAS-driven Meta Ads auto-boost.',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" data-theme="dark" className="dark">
      <body className={`${inter.className} antialiased`} style={{ backgroundColor: 'var(--bg-primary)' }}>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(ORG_JSONLD) }}
        />
        <ThemeProvider>
          <AuthProvider>
            {children}
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
