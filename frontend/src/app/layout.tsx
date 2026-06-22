import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { AuthProvider } from '@/lib/hooks/useAuth';
import { ThemeProvider } from '@/lib/hooks/useTheme';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'NEXUS — Affiliate Automation',
  description: 'NEXUS — the all-in-one AI affiliate engine: discover, generate, publish multi-channel (Telegram + Facebook), and auto-boost with Meta Ads.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" data-theme="dark" className="dark">
      <body className={`${inter.className} antialiased`} style={{ backgroundColor: 'var(--bg-primary)' }}>
        <ThemeProvider>
          <AuthProvider>
            {children}
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
