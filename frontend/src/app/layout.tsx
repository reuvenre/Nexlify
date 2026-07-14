import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { AuthProvider } from '@/lib/hooks/useAuth';
import { ThemeProvider } from '@/lib/hooks/useTheme';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://nexlify.win-solutions.co.il';

/** The company behind the product — surfaced in metadata, schema.org and the UI. */
const VENDOR = { name: 'Win Solutions', url: 'https://win-solutions.co.il' };

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Nexlify — אוטומציית שיווק שותפים מבוססת AI | מבית Win Solutions',
    template: '%s · Nexlify',
  },
  description:
    'Nexlify מבית Win Solutions — מנוע שיווק השותפים שעושה הכל: גילוי מוצרים מ-AliExpress, כתיבת קופי עם AI, פרסום רב-ערוצי (טלגרם + פייסבוק), וקידום אוטומטי לפי ROAS.',
  applicationName: 'Nexlify',
  authors: [{ name: VENDOR.name, url: VENDOR.url }],
  creator: VENDOR.name,
  publisher: VENDOR.name,
  openGraph: {
    type: 'website',
    siteName: 'Nexlify — מבית Win Solutions',
    locale: 'he_IL',
    title: 'Nexlify — אוטומציית שיווק שותפים מבוססת AI | מבית Win Solutions',
    description: 'גילוי מוצרים, קופי עם AI, פרסום רב-ערוצי, וקידום אוטומטי לפי ROAS — מערכת אחת. מבית Win Solutions.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Nexlify — אוטומציית שיווק שותפים מבוססת AI | מבית Win Solutions',
    description: 'גילוי מוצרים, קופי עם AI, פרסום רב-ערוצי, וקידום אוטומטי לפי ROAS — מערכת אחת. מבית Win Solutions.',
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
  publisher: { '@type': 'Organization', name: VENDOR.name, url: VENDOR.url },
  author: { '@type': 'Organization', name: VENDOR.name, url: VENDOR.url },
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
