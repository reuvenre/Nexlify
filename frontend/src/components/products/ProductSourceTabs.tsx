'use client';

import { useRouter, usePathname } from 'next/navigation';
import { ShoppingBag, Store } from 'lucide-react';

/**
 * Source switcher shared by the AliExpress (/products) and FLYLINK (/suppliers) product
 * screens so they read as ONE "מוצרים" dashboard — one nav item, instant client-side
 * toggle between sources, each keeping its full feature set.
 */
export function ProductSourceTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const isFlylink = pathname.startsWith('/suppliers');

  return (
    <div className="flex bg-surface-secondary border border-edge-hover rounded-xl p-1 gap-1 w-fit mb-5">
      <button
        onClick={() => router.push('/products')}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
          !isFlylink ? 'bg-orange-500/15 text-orange-300' : 'text-white/40 hover:text-white/70'
        }`}
      >
        <ShoppingBag size={14} /> AliExpress
      </button>
      <button
        onClick={() => router.push('/suppliers')}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
          isFlylink ? 'bg-violet-500/15 text-violet-300' : 'text-white/40 hover:text-white/70'
        }`}
      >
        <Store size={14} /> FLYLINK
      </button>
    </div>
  );
}
