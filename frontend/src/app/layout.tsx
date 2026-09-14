import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import Script from 'next/script';
import { AuthProvider } from '@/lib/hooks/useAuth';
import { ThemeProvider } from '@/lib/hooks/useTheme';
import { PwaRegister } from '@/components/PwaRegister';
import { CookieConsent } from '@/components/CookieConsent';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://nexlify.win-solutions.co.il';

/** Google Analytics 4 measurement ID. Overridable per-environment; falls back to the production tag. */
const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_ID || 'G-T2ZQPV5QCT';

/** The company behind the product — surfaced in metadata, schema.org and the UI. */
const VENDOR = { name: 'Win Solutions', url: 'https://win-solutions.co.il' };

/**
 * The Pinterest verification token, however it was pasted.
 *
 * Pinterest's claim dialog offers a copy button, and that button copies the WHOLE tag —
 * `<meta name="p:domain_verify" content="abc123">` — not the token. Pasting that into the
 * environment variable emitted a tag whose content was the entire line, and Pinterest
 * answered "we found a different verification code than expected": the one failure message
 * that reads like the token is wrong when the token is fine and only its wrapping is not.
 *
 * So accept what the copy button actually produces. A bare token passes through untouched;
 * a full tag is unwrapped; stray quotes and whitespace are trimmed either way.
 */
function pinterestVerifyToken(): string | null {
  const raw = (process.env.NEXT_PUBLIC_PINTEREST_DOMAIN_VERIFY || '').trim();
  if (!raw) return null;
  const fromTag = raw.match(/content\s*=\s*["']?([^"'>\s]+)/i)?.[1];
  const token = (fromTag || raw).replace(/^["']|["']$/g, '').trim();
  return token || null;
}

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Nexlify — אוטומציית שיווק שותפים מבוססת AI | מבית Win Solutions',
    template: '%s · Nexlify',
  },
  description:
    'Nexlify מבית Win Solutions — מנוע שיווק השותפים שעושה הכל: גילוי מוצרים מ-AliExpress, כתיבת קופי עם AI, פרסום ל-5 פלטפורמות, ומדידת קליקים ועמלות עד רמת הפוסט.',
  applicationName: 'Nexlify',
  authors: [{ name: VENDOR.name, url: VENDOR.url }],
  creator: VENDOR.name,
  publisher: VENDOR.name,
  openGraph: {
    type: 'website',
    siteName: 'Nexlify — מבית Win Solutions',
    locale: 'he_IL',
    title: 'Nexlify — אוטומציית שיווק שותפים מבוססת AI | מבית Win Solutions',
    description: 'גילוי מוצרים, קופי עם AI, פרסום ל-5 פלטפורמות, ומדידת הכנסות עד רמת הפוסט — מערכת אחת. מבית Win Solutions.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Nexlify — אוטומציית שיווק שותפים מבוססת AI | מבית Win Solutions',
    description: 'גילוי מוצרים, קופי עם AI, פרסום ל-5 פלטפורמות, ומדידת הכנסות עד רמת הפוסט — מערכת אחת. מבית Win Solutions.',
  },
  manifest: '/manifest.webmanifest',
  // iOS ignores the manifest's display mode — these are what make "Add to Home Screen"
  // launch full-screen instead of reopening a Safari tab.
  appleWebApp: {
    capable: true,
    title: 'Nexlify',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: '/icon-192.png',
    apple: '/apple-touch-icon.png',
  },
  // Pinterest domain verification.
  //
  // A pin whose destination is an UNCLAIMED domain is the weakest possible signal to
  // Pinterest's index — and an affiliate redirect (s.click.aliexpress.com) is a domain we
  // could never claim, on top of having no page for them to read. 50 pins drew 23
  // impressions in 30 days and none of them appeared in search for their own exact title:
  // created, public, and never indexed.
  //
  // Claiming THIS host is the prerequisite for pointing pins at the storefront instead.
  // The value comes from Pinterest (Settings → Claim → Add HTML tag) and is a public
  // verification token, not a secret — it lives in the environment only so claiming a
  // domain never needs a code change.
  ...(pinterestVerifyToken()
    ? { other: { 'p:domain_verify': pinterestVerifyToken() as string } }
    : {}),
};

export const viewport: Viewport = {
  themeColor: '#3B82F6',
  width: 'device-width',
  initialScale: 1,
  // Let the app paint under the notch/home indicator once installed standalone.
  viewportFit: 'cover',
};

const ORG_JSONLD = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Nexlify',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  description:
    'All-in-one AI affiliate marketing automation: AliExpress product discovery, AI copywriting, 5-platform publishing, and per-post click & commission attribution.',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  publisher: { '@type': 'Organization', name: VENDOR.name, url: VENDOR.url },
  author: { '@type': 'Organization', name: VENDOR.name, url: VENDOR.url },
};

/**
 * LIGHT is the first-visit default — a first-time visitor should land on the bright,
 * conventional look, not a dark one they never chose. A returning user's pick is restored
 * from localStorage by the inline script below, which runs before first paint so choosing
 * dark never costs them a white flash on every page load.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" data-theme="light">
      <head>
        {/* Runs BEFORE paint, so a user who chose dark never sees a white flash first.
            Must stay inline and synchronous — a React effect runs too late for that. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(localStorage.getItem('alibot-theme')==='dark'){`
              + `document.documentElement.setAttribute('data-theme','dark');`
              + `document.documentElement.classList.add('dark');}}catch(e){}})();`,
          }}
        />
        {/* Google Translate rewrites the DOM under React's feet — it wraps text nodes in
            its own <font> tags — and React's next update then removes/inserts against
            nodes that are no longer where it left them, crashing the page the moment a
            translated user clicks anything that re-renders (save, connect). The standard
            guard (facebook/react#11538): make those two DOM calls tolerate a foreign
            parent instead of throwing. Must run before hydration, hence inline here. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){if(typeof Node!=='function'||!Node.prototype)return;`
              + `var rc=Node.prototype.removeChild;`
              + `Node.prototype.removeChild=function(c){if(c&&c.parentNode!==this)return c;return rc.apply(this,arguments);};`
              + `var ib=Node.prototype.insertBefore;`
              + `Node.prototype.insertBefore=function(n,r){if(r&&r.parentNode!==this)return n;return ib.apply(this,arguments);};})();`,
          }}
        />
      </head>
      <body className={`${inter.className} antialiased`} style={{ backgroundColor: 'var(--bg-primary)' }}>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(ORG_JSONLD) }}
        />
        {GA_MEASUREMENT_ID && (
          <>
            {/* Consent Mode v2: DENY analytics/ad storage by default — GA sends cookieless
                pings until the CookieConsent banner grants it. Must run before gtag config. */}
            <Script id="gtag-consent-default" strategy="beforeInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('consent', 'default', {
                  ad_storage: 'denied',
                  ad_user_data: 'denied',
                  ad_personalization: 'denied',
                  analytics_storage: 'denied',
                  wait_for_update: 500
                });
              `}
            </Script>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
              strategy="afterInteractive"
            />
            <Script id="gtag-init" strategy="afterInteractive">
              {`
                gtag('js', new Date());
                gtag('config', '${GA_MEASUREMENT_ID}');
              `}
            </Script>
          </>
        )}
        <CookieConsent />
        <PwaRegister />
        <ThemeProvider>
          <AuthProvider>
            {children}
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
