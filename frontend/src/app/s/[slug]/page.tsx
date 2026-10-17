'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Loader2, SlidersHorizontal, X } from 'lucide-react';
import { storeApi, yupooImg } from '@/lib/api-client';
import type { StoreMeta, StoreProduct, StoreSort } from '@/types';
import { StoreShell } from './StoreShell';
import { FilterPanel } from './FilterPanel';
import './store.css';

import { DialogA11y } from '@/components/common/DialogA11y';
/**
 * The public storefront: everything this seller offers, on one shelf.
 *
 * Every filter lives in the URL, never in component state — a filtered shelf has to be
 * something a shopper can send to a friend, open in a second tab, and come back to with
 * the back button. That is what a shop is.
 */

function priceLabel(p: StoreProduct): string {
  const symbol = p.currency === 'ILS' ? '₪' : p.currency === 'USD' ? '$' : '';
  const value = Math.round(p.price * 100) / 100;
  return symbol ? `${symbol} ${value}` : `${value} ${p.currency}`;
}

export default function StorePage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const params = useSearchParams();

  const brand = params.get('brand') || '';
  const category = params.get('category') || '';
  const q = params.get('q') || '';
  const minPrice = params.get('min_price') || '';
  const maxPrice = params.get('max_price') || '';
  const sort = (params.get('sort') || 'newest') as StoreSort;

  const [meta, setMeta] = useState<StoreMeta | null>(null);
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [bounds, setBounds] = useState({ min: 0, max: 0 });
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    storeApi.meta(slug).then(setMeta).catch(() => setMissing(true));
  }, [slug]);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await storeApi.products(slug, {
        page: p, brand, category, q, sort,
        min_price: minPrice ? Number(minPrice) : undefined,
        max_price: maxPrice ? Number(maxPrice) : undefined,
      });
      // Page 1 replaces; "load more" appends — the shelf grows under the reader instead
      // of resetting their scroll position.
      setProducts((prev) => (p === 1 ? res.products : [...prev, ...res.products]));
      setPages(res.pages);
      setTotal(res.total);
      setBounds(res.priceRange);
      setPage(res.page);
    } catch {
      setMissing(true);
    } finally {
      setLoading(false);
    }
  }, [slug, brand, category, q, sort, minPrice, maxPrice]);

  useEffect(() => { void load(1); }, [load]);

  /** Patch the query string. An empty value REMOVES its key, so URLs stay short. */
  const setParams = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value); else next.delete(key);
    }
    router.push(`/s/${slug}${next.toString() ? `?${next}` : ''}`);
    setDrawer(false);
  };

  if (missing) {
    return (
      <div className="store-root flex items-center justify-center p-8" dir="rtl">
        <div className="text-center">
          <h1 className="store-wordmark text-2xl font-bold mb-2">החנות לא נמצאה</h1>
          <p className="text-sm text-[var(--store-muted)]">ייתכן שהכתובת שגויה או שהחנות אינה פעילה.</p>
        </div>
      </div>
    );
  }

  if (!meta) {
    return (
      <div className="store-root flex items-center justify-center p-8">
        <Loader2 className="animate-spin text-[var(--store-gold)]" />
      </div>
    );
  }

  const active = [brand, category, minPrice, maxPrice].filter(Boolean).length;
  const heading = brand || category || 'כל המוצרים';

  const panel = (
    <FilterPanel
      meta={meta}
      sort={sort}
      brand={brand}
      category={category}
      minPrice={minPrice}
      maxPrice={maxPrice}
      bounds={bounds}
      onChange={setParams}
    />
  );

  return (
    <StoreShell meta={meta} search={q} onSearch={(v) => setParams({ q: v, page: '' })}>
      <div className="lg:grid lg:grid-cols-[260px_1fr] lg:gap-8">
        {/* Desktop: a standing column. Phone: a drawer, because a filter panel above the
            products pushes the products off the first screen. */}
        <aside className="hidden lg:block">{panel}</aside>

        <div>
          <h1 className="text-3xl sm:text-4xl font-bold mb-1">{heading}</h1>
          <p role="status" className="text-sm text-[var(--store-muted)] mb-5">
            {total > 0 ? `${total} מוצרים` : loading ? 'טוען…' : 'אין מוצרים להצגה'}
            {q && ` · חיפוש: "${q}"`}
          </p>

          <div className="lg:hidden mb-5">
            <button onClick={() => setDrawer(true)} aria-expanded={drawer} className="store-chip flex items-center gap-2" data-active={active > 0}>
              <SlidersHorizontal size={14} /> סינון{active > 0 ? ` (${active})` : ''}
            </button>
          </div>

          {active > 0 && (
            <div className="flex flex-wrap items-center gap-2 mb-5">
              {[
                brand && { key: 'brand', label: brand },
                category && { key: 'category', label: category },
                (minPrice || maxPrice) && {
                  key: 'price',
                  label: `${minPrice || bounds.min}–${maxPrice || bounds.max}`,
                },
              ].filter(Boolean).map((chip) => {
                const c = chip as { key: string; label: string };
                return (
                  <button
                    key={c.key}
                    onClick={() => setParams(c.key === 'price'
                      ? { min_price: '', max_price: '', page: '' }
                      : { [c.key]: '', page: '' })}
                    className="store-chip flex items-center gap-1.5"
                    data-active
                    aria-label={`הסרת המסנן ${c.label}`}
                  >
                    {c.label} <X size={12} />
                  </button>
                );
              })}
              <button
                onClick={() => setParams({ brand: '', category: '', min_price: '', max_price: '', page: '' })}
                className="text-xs text-[var(--store-muted)] underline"
              >
                נקה הכל
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
            {products.map((p) => (
              <Link key={p.id} href={`/s/${slug}/p/${encodeURIComponent(p.id)}`} className="store-card block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={yupooImg(p.image || '')} alt="" className="store-photo" loading="lazy" />
                <div className="p-3">
                  <h2 className="text-sm font-medium leading-snug line-clamp-2 mb-1.5">{p.title}</h2>
                  <div className="store-price text-base mb-1">{priceLabel(p)}</div>
                  {p.brand && <div className="store-brand text-[11px]">{p.brand}</div>}
                </div>
              </Link>
            ))}
          </div>

          {loading && (
            <div className="flex justify-center py-8">
              <Loader2 className="animate-spin text-[var(--store-gold)]" />
            </div>
          )}

          {!loading && page < pages && (
            <div className="flex justify-center py-8">
              <button onClick={() => load(page + 1)} className="store-chip px-6 py-2.5">
                טען עוד מוצרים
              </button>
            </div>
          )}
        </div>
      </div>

      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setDrawer(false)}>
          <DialogA11y label="סינון מוצרים" onClose={() => setDrawer(false)} />
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="absolute inset-y-0 right-0 w-[88%] max-w-sm bg-[var(--store-bg)] p-5 overflow-y-auto shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={() => setDrawer(false)} aria-label="סגור" className="mb-4"><X size={20} /></button>
            {panel}
          </div>
        </div>
      )}
    </StoreShell>
  );
}
