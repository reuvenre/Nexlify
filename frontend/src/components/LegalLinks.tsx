'use client';

import Link from 'next/link';
import { CookieSettingsButton } from '@/components/CookieConsent';

/**
 * The legal links every public page carries: privacy, terms, accessibility statement and
 * the way back into the cookie choices. One component so no footer can drop one of them.
 */
export function LegalLinks({ className = '', linkClassName = '' }: { className?: string; linkClassName?: string }) {
  const cls = linkClassName || 'underline-offset-2 hover:underline';
  return (
    <nav aria-label="מידע משפטי" className={`flex flex-wrap items-center justify-center gap-x-4 gap-y-1 ${className}`}>
      <Link href="/privacy" className={cls}>מדיניות פרטיות</Link>
      <Link href="/terms" className={cls}>תנאי שימוש</Link>
      <Link href="/accessibility" className={cls}>הצהרת נגישות</Link>
      <CookieSettingsButton className={cls} />
    </nav>
  );
}
