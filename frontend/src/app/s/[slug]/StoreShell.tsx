'use client';

import Link from 'next/link';
import { ChevronDown, Search, X, Menu } from 'lucide-react';
import { useState } from 'react';
import type { StoreMeta } from '@/types';
import { LegalLinks } from '@/components/LegalLinks';

import { DialogA11y } from '@/components/common/DialogA11y';
/**
 * The store's chrome: wordmark, menu, search.
 *
 * Shared by the grid and the product page so a follower who lands deep — which is what a
 * link in a post produces — still has a way into the rest of the catalog. That is the
 * whole point of the store: they came for one product, they should leave having seen ten.
 */
export function StoreShell({
  meta, children, search, onSearch,
}: {
  meta: StoreMeta;
  children: React.ReactNode;
  search?: string;
  onSearch?: (v: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [term, setTerm] = useState(search || '');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch?.(term);
    setMenu(false);
  };

  return (
    <div className="store-root" dir="rtl">
      <header className="sticky top-0 z-30 bg-[var(--store-bg)]/95 backdrop-blur border-b border-[var(--store-line)]">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between gap-3">
          <button
            onClick={() => setMenu(true)}
            aria-label="תפריט"
            aria-expanded={menu}
            className="p-2 -mr-2 text-[var(--store-ink)] lg:hidden"
          >
            <Menu size={22} />
          </button>

          {/* On a wide screen the search box is the middle of the bar rather than a thing
              hidden behind a hamburger — a catalog is searched far more than it is browsed. */}
          <form role="search" onSubmit={submit} className="hidden lg:block relative flex-1 max-w-md mx-8">
            <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--store-muted)]" />
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="חיפוש מוצרים…"
              aria-label="חיפוש מוצרים"
              className="w-full bg-[var(--store-card)] border border-[var(--store-line)] rounded-full py-2 pr-9 pl-3 text-sm outline-none focus:border-[var(--store-gold)]"
            />
          </form>

          <Link href={`/s/${meta.slug}`} className="store-wordmark text-xl sm:text-2xl font-bold shrink-0">
            {meta.name}
          </Link>
        </div>

        {/* The nav row: the catalog's own shape, one tap from anywhere. Categories and
            brands appear only once the enrichment agent has given them something to list. */}
        <nav aria-label="קטגוריות" className="hidden lg:block border-t border-[var(--store-line)]">
          <div className="max-w-6xl mx-auto px-4 h-11 flex items-center justify-end gap-6 text-sm">
            {meta.brands.length > 0 && (
              <Dropdown label="חיפוש לפי מותג" items={meta.brands} slug={meta.slug} param="brand" />
            )}
            {meta.categories.length > 0 && (
              <Dropdown label="חיפוש לפי קטגוריה" items={meta.categories} slug={meta.slug} param="category" />
            )}
            <Link href={`/s/${meta.slug}`} className="hover:text-[var(--store-gold)]">כל המוצרים</Link>
          </div>
        </nav>
      </header>

      {menu && (
        <div className="fixed inset-0 z-40" onClick={() => setMenu(false)}>
          <DialogA11y label="תפריט" onClose={() => setMenu(false)} />
          <div className="absolute inset-0 bg-black/30" />
          <nav
            className="absolute inset-y-0 right-0 w-[85%] max-w-sm bg-[var(--store-bg)] p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <button onClick={() => setMenu(false)} aria-label="סגור"><X size={20} /></button>
              <span className="font-semibold">תפריט</span>
            </div>

            <form role="search" onSubmit={submit} className="relative mb-6">
              <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--store-muted)]" />
              <input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="חפש מוצרים…"
                aria-label="חיפוש מוצרים"
                className="w-full bg-[var(--store-card)] border border-[var(--store-line)] rounded-xl py-3 pr-10 pl-3 text-sm outline-none focus:border-[var(--store-gold)]"
              />
            </form>

            <div className="space-y-1 text-lg">
              <Link href={`/s/${meta.slug}`} onClick={() => setMenu(false)} className="block py-2.5">
                כל המוצרים
              </Link>
              {meta.categories.slice(0, 14).map((c) => (
                <Link
                  key={c}
                  href={`/s/${meta.slug}?category=${encodeURIComponent(c)}`}
                  onClick={() => setMenu(false)}
                  className="block py-2.5 text-[var(--store-muted)]"
                >
                  {c}
                </Link>
              ))}
            </div>

            {meta.whatsapp && (
              <a
                href={waLink(meta.whatsapp)}
                target="_blank"
                rel="noopener noreferrer"
                className="store-whatsapp mt-8"
              >
                צור קשר בוואטסאפ
              </a>
            )}
          </nav>
        </div>
      )}

      <main id="main" tabIndex={-1} className="max-w-6xl mx-auto px-4 py-6 outline-none">{children}</main>

      <footer className="border-t border-[var(--store-line)] mt-12">
        <div className="max-w-6xl mx-auto px-4 py-8 text-center text-xs text-[var(--store-muted)] space-y-2">
          {meta.tagline && <p>{meta.tagline}</p>}
          <p>© {new Date().getFullYear()} {meta.name}</p>
          <LegalLinks className="pt-1" />
        </div>
      </footer>
    </div>
  );
}

/**
 * One nav dropdown. Opens on click rather than hover: this same bar is read on a laptop
 * with a trackpad and on a tablet, and a hover menu is unreachable on the second.
 */
function Dropdown({ label, items, slug, param }: {
  label: string; items: string[]; slug: string; param: 'brand' | 'category';
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="true" className="flex items-center gap-1 hover:text-[var(--store-gold)]">
        <ChevronDown size={14} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
        {label}
      </button>
      {open && (
        <>
          {/* A click anywhere else closes it — without this the menu stays open behind
              whatever the shopper does next. */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full right-0 mt-2 z-20 w-56 max-h-96 overflow-y-auto rounded-xl border border-[var(--store-line)] bg-[var(--store-card)] shadow-lg py-2">
            {items.map((item) => (
              <Link
                key={item}
                href={`/s/${slug}?${param}=${encodeURIComponent(item)}`}
                onClick={() => setOpen(false)}
                className="block px-4 py-2 text-sm hover:bg-black/[0.04]"
                dir="auto"
              >
                {item}
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** wa.me wants digits only — a pasted number arrives with +, dashes and spaces. */
export function waLink(number: string, text?: string): string {
  const digits = String(number || '').replace(/\D/g, '');
  const q = text ? `?text=${encodeURIComponent(text)}` : '';
  return `https://wa.me/${digits}${q}`;
}
