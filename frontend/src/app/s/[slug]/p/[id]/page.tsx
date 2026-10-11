'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Loader2, Link2, Check,
} from 'lucide-react';
import { storeApi, yupooImg } from '@/lib/api-client';
import type { StoreMeta, StoreProduct } from '@/types';
import { StoreShell, waLink } from '../../StoreShell';
import '../../store.css';

/**
 * One product, as a follower arriving from a post sees it.
 *
 * The buy button points at the tracked /r/<code> the API hands back — not at the raw
 * affiliate URL — so a sale that started here is counted as evidence about this product,
 * exactly like a click in the channel.
 */

/**
 * The buy link, tagged with where the visitor came from. A pin's link carries ?src=pin
 * (backend storefront postProductUrl); the tracked /r/<code> then records the click as
 * Pinterest's (?s=pin), so a sale that started on a pin is no longer counted as nobody's.
 */
function taggedBuyUrl(url: string): string {
  if (typeof window === 'undefined' || !/\/r\/[A-Za-z0-9]+$/.test(url.split('?')[0])) return url;
  const src = new URLSearchParams(window.location.search).get('src');
  if (src !== 'pin' || /[?&]s=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}s=pin`;
}

function priceLabel(p: StoreProduct): string {
  const symbol = p.currency === 'ILS' ? '₪' : p.currency === 'USD' ? '$' : '';
  const value = Math.round(p.price * 100) / 100;
  return symbol ? `${symbol} ${value}` : `${value} ${p.currency}`;
}

/**
 * The shipping text points buyers at their tracking page. Left as plain text those
 * addresses are something to retype by hand off a phone screen — the one moment the
 * section exists for is the moment it stops being useful.
 */
function linkify(text: string): React.ReactNode[] {
  return String(text || '').split(/(https?:\/\/[^\s<>"')\]]+)/g).map((part, i) => (
    /^https?:\/\//.test(part)
      ? (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--store-gold)] underline break-all"
          dir="ltr"
        >
          {part}
        </a>
      )
      : <span key={i}>{part}</span>
  ));
}

function Accordion({ title, body, defaultOpen = false }: {
  title: string; body: string; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-[var(--store-line)]">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between py-4 text-right">
        <ChevronDown size={18} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        <span className="font-medium">{title}</span>
      </button>
      {open && (
        <p className="pb-4 text-sm leading-relaxed text-[var(--store-muted)] whitespace-pre-line">
          {linkify(body)}
        </p>
      )}
    </div>
  );
}

export default function StoreProductPage() {
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const [meta, setMeta] = useState<StoreMeta | null>(null);
  const [product, setProduct] = useState<(StoreProduct & { buy_url: string }) | null>(null);
  const [missing, setMissing] = useState(false);
  const [index, setIndex] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    storeApi.meta(slug).then(setMeta).catch(() => setMissing(true));
    storeApi.product(slug, decodeURIComponent(id)).then(setProduct).catch(() => setMissing(true));
  }, [slug, id]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked (http, or an in-app browser) — the share row still works */ }
  };

  if (missing) {
    return (
      <div className="store-root flex items-center justify-center p-8" dir="rtl">
        <div className="text-center">
          <h1 className="store-wordmark text-2xl font-bold mb-2">המוצר לא נמצא</h1>
          <Link href={`/s/${slug}`} className="text-sm text-[var(--store-gold)]">חזרה לכל המוצרים</Link>
        </div>
      </div>
    );
  }

  if (!meta || !product) {
    return (
      <div className="store-root flex items-center justify-center p-8">
        <Loader2 className="animate-spin text-[var(--store-gold)]" />
      </div>
    );
  }

  const gallery = product.gallery.length ? product.gallery : [product.image || ''];
  const shown = gallery[Math.min(index, gallery.length - 1)] || '';

  return (
    <StoreShell meta={meta}>
      <nav className="text-xs text-[var(--store-muted)] mb-4">
        <Link href={`/s/${slug}`}>כל המוצרים</Link>
        <span className="mx-2">›</span>
        <span className="text-[var(--store-ink)]">{product.title}</span>
      </nav>

      <div className="grid lg:grid-cols-2 gap-6 lg:gap-10">
        <div>
          <div className="store-card relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={yupooImg(shown)} alt={product.title} className="store-photo" />
            {gallery.length > 1 && (
              <>
                <button
                  onClick={() => setIndex((i) => (i - 1 + gallery.length) % gallery.length)}
                  aria-label="הקודם"
                  className="absolute top-1/2 right-2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/90 shadow flex items-center justify-center"
                >
                  <ChevronRight size={18} />
                </button>
                <button
                  onClick={() => setIndex((i) => (i + 1) % gallery.length)}
                  aria-label="הבא"
                  className="absolute top-1/2 left-2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/90 shadow flex items-center justify-center"
                >
                  <ChevronLeft size={18} />
                </button>
              </>
            )}
          </div>

          {gallery.length > 1 && (
            <div className="flex justify-center gap-1.5 mt-3">
              {gallery.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setIndex(i)}
                  aria-label={`תמונה ${i + 1}`}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    i === Math.min(index, gallery.length - 1)
                      ? 'bg-[var(--store-gold)]' : 'bg-[var(--store-line)]'
                  }`}
                />
              ))}
            </div>
          )}
        </div>

        <div>
          {product.brand && <div className="store-brand text-xs mb-2">{product.brand}</div>}
          <h1 className="text-2xl sm:text-3xl font-bold leading-tight mb-3">{product.title}</h1>
          {/* "estimated" is not a hedge — the price was captured when the deal was
              published and the seller's page is the authority at checkout. */}
          <div className="store-price text-2xl mb-6">{priceLabel(product)} <span className="text-base font-normal">(משוער)</span></div>

          <a href={taggedBuyUrl(product.buy_url)} target="_blank" rel="noopener noreferrer sponsored" className="store-buy mb-3">
            <ExternalLink size={16} /> לרכישה
          </a>

          {meta.whatsapp && (
            <a
              href={waLink(meta.whatsapp, `שלום, אשמח לפרטים על: ${product.title}`)}
              target="_blank"
              rel="noopener noreferrer"
              className="store-whatsapp mb-5"
            >
              התייעץ בוואטסאפ
            </a>
          )}

          <div className="flex items-center gap-2 mb-6">
            <button onClick={copyLink} className="store-chip flex items-center gap-1.5">
              {copied ? <Check size={13} /> : <Link2 size={13} />} {copied ? 'הועתק' : 'העתק קישור'}
            </button>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(`${product.title}\n${typeof window !== 'undefined' ? window.location.href : ''}`)}`}
              target="_blank" rel="noopener noreferrer" className="store-chip"
            >
              שתף בוואטסאפ
            </a>
          </div>

          {/* Both sections always have content — the API falls back to the standing
              defaults — so a product page can never ship with them missing. "פרטי מוצר"
              opens by default: what am I actually getting is the question a buyer of a
              hidden-brand product has before any other. */}
          {meta.shipping_text && <Accordion title="משלוח" body={meta.shipping_text} />}
          {meta.details_text && <Accordion title="פרטי מוצר" body={meta.details_text} defaultOpen />}
        </div>
      </div>
    </StoreShell>
  );
}
