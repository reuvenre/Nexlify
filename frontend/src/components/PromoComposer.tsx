'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Loader2, Search, Package, Globe, Boxes, Clock, Percent,
  ArrowRight, RefreshCw, CalendarClock, Link2, X, Plus,
  ChevronLeft, ChevronRight, ImagePlus,
} from 'lucide-react';
import { ProductCard } from '@/components/products/ProductCard';
import { GroupMultiSelect, type GroupOption } from '@/components/GroupMultiSelect';
import { productsApi, postsApi, catalogApi, suppliersApi, yupooImg } from '@/lib/api-client';
import type { AliProduct, CatalogProduct, SupplierProduct, SupplierCatalog } from '@/types';

// ── Product → AliProduct adapters (the shape the picker + preview expect) ───────
function catalogToAli(c: CatalogProduct): AliProduct {
  return {
    product_id: c.product_id, title: c.title,
    original_price: c.original_price, sale_price: c.sale_price,
    discount_percent: c.discount_percent, image_url: c.image_url,
    product_url: c.product_url, affiliate_url: c.affiliate_url,
    category: c.category, orders_count: c.orders_count, rating: c.rating, currency: c.currency,
  };
}
function supplierToAli(s: SupplierProduct): AliProduct {
  const price = s.price_ils ?? s.price;
  return {
    product_id: s.id, title: s.title,
    original_price: price, sale_price: price, discount_percent: 0,
    image_url: yupooImg(s.image_url),
    product_url: s.flylink_url || s.yupoo_url || '',
    affiliate_url: s.flylink_url || '',
    category: '', orders_count: 0, rating: 0,
    currency: s.display_currency || s.currency || 'ILS',
  };
}

/** All of a supplier product's images (colors/variants), routed through the Yupoo proxy so
 *  Telegram can fetch them. Falls back to the single main image. */
function supplierGallery(s: SupplierProduct): string[] {
  let arr: string[] = [];
  try { arr = JSON.parse(s.gallery_json || '[]'); } catch { arr = []; }
  const urls = (arr.length ? arr : [s.image_url]).filter(Boolean).map((u) => yupooImg(u));
  // de-dupe while preserving order
  return Array.from(new Set(urls));
}

/** A raw catalog album from browse() — not yet linked (no FLYLINK buyer link). */
interface BrowseAlbum { code: string; price: number; currency?: string; description: string; album_url: string; thumb?: string }
function albumToAli(a: BrowseAlbum): AliProduct {
  return {
    product_id: a.code, title: a.description || a.code,
    original_price: a.price, sale_price: a.price, discount_percent: 0,
    image_url: yupooImg(a.thumb), product_url: a.album_url, affiliate_url: '',
    category: '', orders_count: 0, rating: 0, currency: a.currency || 'ILS',
  };
}

const HE_RE = /[֐-׿]/;
async function translateHebrew(text: string): Promise<string> {
  if (!HE_RE.test(text)) return text;
  try {
    const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=he|en`);
    const json = await res.json();
    return (json?.responseData?.translatedText || text).replace(/&#(\d+);/g, (_: string, n: string) => String.fromCharCode(+n));
  } catch { return text; }
}

/** ISO → <input type="datetime-local"> value (local tz). */
function toLocalInput(offsetMs = 3600_000): string {
  const d = new Date(Date.now() + offsetMs);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

type Source = 'catalog' | 'live' | 'flylink';
const LINKED = '__linked__'; // FLYLINK sub-selector value for "my already-linked products"

/**
 * Product-based LIMITED-TIME PROMO composer for the Scheduled Posts screen. Pick a product
 * — from the AliExpress catalog / live search, from already-linked FLYLINK products, OR by
 * browsing a full FLYLINK catalog (a not-yet-linked album asks for its FLYLINK buyer link
 * once, then it's saved). The AI writes sale-urgency copy; set discount + deadline + send
 * time + groups; the published post auto-removes itself from Telegram when the promo ends.
 */
export function PromoComposer({ channels, onScheduled }: { channels: GroupOption[]; onScheduled: () => void }) {
  const [source, setSource] = useState<Source>('flylink');
  const [products, setProducts] = useState<AliProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  // FLYLINK catalog browsing
  const [catalogs, setCatalogs] = useState<SupplierCatalog[]>([]);
  const [flylinkSel, setFlylinkSel] = useState<string>(LINKED); // LINKED or a catalog id
  const [linkedByCode, setLinkedByCode] = useState<Record<string, SupplierProduct>>({});
  const [supplierById, setSupplierById] = useState<Record<string, SupplierProduct>>({}); // linked products by id (for gallery)
  const [albumsRaw, setAlbumsRaw] = useState<Record<string, BrowseAlbum>>({});
  const [pendingAlbum, setPendingAlbum] = useState<BrowseAlbum | null>(null);
  const [flylinkInput, setFlylinkInput] = useState('');
  const [linking, setLinking] = useState(false);

  // Review
  const [selected, setSelected] = useState<AliProduct | null>(null);
  const [affiliateUrl, setAffiliateUrl] = useState('');
  const [text, setText] = useState('');
  const [hint, setHint] = useState(''); // product description → authoritative for the AI when vision/title misleads
  const [imagesText, setImagesText] = useState(''); // one image URL per line → gallery/album (canonical store)
  const [imagePool, setImagePool] = useState<string[]>([]); // all available images for the product (for the visual picker)
  const [addUrl, setAddUrl] = useState(''); // manual "add image by URL" input
  const [generating, setGenerating] = useState(false);

  const [discount, setDiscount] = useState('');
  const [endsAt, setEndsAt] = useState(toLocalInput(24 * 3600_000));
  const [sendAt, setSendAt] = useState(toLocalInput());
  const [channelIds, setChannelIds] = useState<string[]>([]);

  const [scheduling, setScheduling] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => { suppliersApi.listCatalogs().then(setCatalogs).catch(() => {}); }, []);

  // ── Load products for the chosen source ──
  const loadProducts = useCallback(async (search?: string) => {
    setLoading(true);
    setPendingAlbum(null);
    try {
      if (source === 'flylink') {
        if (flylinkSel === LINKED) {
          const rows = await suppliersApi.listProducts();
          const q = (search || '').trim().toLowerCase();
          const filtered = rows.filter((r) => r.flylink_url && (!q || (r.title || '').toLowerCase().includes(q)));
          const byId: Record<string, SupplierProduct> = {};
          for (const r of filtered) byId[r.id] = r;
          setSupplierById(byId);
          setProducts(filtered.map(supplierToAli));
        } else {
          // Browse a full catalog. Map linked products by code so an album we already have a
          // buyer link for skips the paste step.
          const [linked, browsed] = await Promise.all([
            suppliersApi.listProducts(flylinkSel).catch(() => [] as SupplierProduct[]),
            suppliersApi.browse(flylinkSel, { page: 1, with_categories: 0 }).catch(() => ({ items: [] as BrowseAlbum[], hasMore: false })),
          ]);
          const byCode: Record<string, SupplierProduct> = {};
          for (const p of linked) if (p.sku) byCode[p.sku] = p;
          setLinkedByCode(byCode);
          const raw: Record<string, BrowseAlbum> = {};
          for (const a of browsed.items) raw[a.code] = a;
          setAlbumsRaw(raw);
          const q = (search || '').trim().toLowerCase();
          setProducts(browsed.items.filter((a) => !q || (a.description || '').toLowerCase().includes(q)).map(albumToAli));
        }
      } else if (source === 'catalog') {
        const res = await catalogApi.list({ page: 1, limit: 50, search: search?.trim() || undefined });
        setProducts(res.data.map(catalogToAli));
      } else {
        const res = search?.trim()
          ? await productsApi.search({ keyword: await translateHebrew(search.trim()), page: 1, limit: 50 })
          : await productsApi.featured({ sort: 'best_selling', page: 1, limit: 50 });
        setProducts(res.data);
      }
    } catch {
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [source, flylinkSel]);

  useEffect(() => { setQuery(''); loadProducts(); }, [loadProducts]);

  const promoPreview = () => ({ ends_at: new Date(endsAt).toISOString(), discount: discount ? Number(discount) : null });

  // ── Move a resolved product into the review flow: resolve link + generate copy ──
  const pickProduct = async (p: AliProduct, knownAffiliate?: string, gallery?: string[]) => {
    setSelected(p);
    setText('');
    setError('');
    setPendingAlbum(null);
    // Pre-fill the gallery: a FLYLINK product carries all its color/variant images; others
    // start with the single main image. The user can add/remove URLs.
    const imgs = (gallery && gallery.length ? gallery : [p.image_url]).filter(Boolean);
    setImagesText(imgs.join('\n'));
    setImagePool(Array.from(new Set(imgs))); // the full pool the visual picker can re-add from
    setAddUrl('');
    let aff = knownAffiliate ?? (p.affiliate_url || p.product_url || '');
    if (!knownAffiliate && source === 'live') {
      try { aff = (await productsApi.affiliateLink(p.product_id)).url; } catch { /* keep fallback */ }
    } else if (!knownAffiliate && source === 'catalog') {
      try { aff = (await productsApi.affiliateLink(p.product_id)).url; } catch { aff = p.affiliate_url || p.product_url || ''; }
    }
    setAffiliateUrl(aff);
    await generate(p, aff);
  };

  // ── Grid click: FLYLINK browse albums may need linking first ──
  const onCardSelect = async (p: AliProduct) => {
    if (source === 'flylink' && flylinkSel !== LINKED) {
      const linked = linkedByCode[p.product_id];
      if (linked?.flylink_url) { await pickProduct(supplierToAli(linked), linked.flylink_url, supplierGallery(linked)); return; }
      // Not linked yet → ask for the FLYLINK buyer link.
      setPendingAlbum(albumsRaw[p.product_id] || null);
      setFlylinkInput('');
      return;
    }
    if (source === 'flylink' && flylinkSel === LINKED) {
      const sp = supplierById[p.product_id];
      await pickProduct(p, p.affiliate_url, sp ? supplierGallery(sp) : undefined);
      return;
    }
    await pickProduct(p);
  };

  const confirmLink = async () => {
    if (!pendingAlbum) return;
    const url = flylinkInput.trim();
    if (!/^https?:\/\//i.test(url)) { setError('הדבק קישור FLYLINK תקין (מתחיל ב-http)'); return; }
    setLinking(true);
    setError('');
    try {
      const saved = await suppliersApi.link({
        catalogId: flylinkSel, yupooUrl: pendingAlbum.album_url, flylinkUrl: url, code: pendingAlbum.code,
      });
      await pickProduct(supplierToAli(saved), saved.flylink_url || url, supplierGallery(saved));
    } catch (e: any) {
      setError(e?.response?.data?.message || 'קישור המוצר נכשל — בדוק את הקישור');
    } finally {
      setLinking(false);
    }
  };

  const generate = async (p = selected, aff = affiliateUrl) => {
    if (!p) return;
    setGenerating(true);
    setError('');
    try {
      const res = await postsApi.preview(p.product_id, 'he', p, undefined, promoPreview(), hint.trim() || undefined);
      let t = res.generated_text;
      if (aff && !t.includes(aff)) t += '\n\n🔗 ' + aff;
      setText(t);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'יצירת הטקסט נכשלה — נסה שוב');
    } finally {
      setGenerating(false);
    }
  };

  const reset = () => { setSelected(null); setText(''); setHint(''); setImagesText(''); setImagePool([]); setAddUrl(''); setAffiliateUrl(''); setDiscount(''); setPendingAlbum(null); };

  // ── Visual gallery editor (operates on imagesText as the canonical store) ──
  const imagesArr = imagesText.split('\n').map((s) => s.trim()).filter(Boolean);
  const setImages = (arr: string[]) => setImagesText(Array.from(new Set(arr)).slice(0, 10).join('\n'));
  const removeImage = (url: string) => setImages(imagesArr.filter((u) => u !== url));
  const addImage = (url: string) => { if (url && !imagesArr.includes(url)) setImages([...imagesArr, url]); };
  const moveImage = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= imagesArr.length) return;
    const next = [...imagesArr];
    [next[i], next[j]] = [next[j], next[i]];
    setImages(next);
  };
  const unusedPool = imagePool.filter((u) => !imagesArr.includes(u));

  const schedule = async () => {
    if (!selected) return;
    if (!text.trim()) { setError('אין טקסט לפוסט'); return; }
    if (!channelIds.length) { setError('בחר לפחות קבוצת יעד אחת'); return; }
    if (!endsAt) { setError('קבע מועד סיום למבצע'); return; }
    if (new Date(endsAt).getTime() <= new Date(sendAt).getTime()) { setError('מועד סיום המבצע חייב להיות אחרי מועד הפרסום'); return; }
    setScheduling(true);
    setError('');
    try {
      const images = imagesText.split('\n').map((s) => s.trim()).filter(Boolean);
      await postsApi.schedulePost({
        product_id: selected.product_id,
        scheduled_at: new Date(sendAt).toISOString(),
        text,
        channels: channelIds,
        product_image: images[0] || selected.image_url,
        images: images.length > 1 ? images : undefined,
        affiliate_url: affiliateUrl || undefined,
        product: {
          title: selected.title, sale_price: selected.sale_price, original_price: selected.original_price,
          currency: selected.currency, discount_percent: selected.discount_percent,
          orders_count: selected.orders_count, rating: selected.rating,
        },
        promo: { is_promo: true, ends_at: new Date(endsAt).toISOString(), discount: discount ? Number(discount) : null },
      });
      setDone(true);
      // Long enough to actually READ — 2.5s vanished together with the form, and since a
      // product promo lands in the POSTS queue (not this screen's list), the owner watched
      // his post "disappear" on confirm.
      setTimeout(() => { setDone(false); reset(); onScheduled(); }, 7000);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'התזמון נכשל — נסה שוב');
    } finally {
      setScheduling(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // REVIEW
  // ─────────────────────────────────────────────────────────────────────────────
  if (selected) {
    return (
      <div className="space-y-4">
        <button onClick={reset} className="flex items-center gap-2 text-white/50 hover:text-white/90 text-sm">
          <ArrowRight size={15} /> חזרה לבחירת מוצר
        </button>

        {done && (
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 text-sm text-emerald-400 text-center">
            ✅ המבצע תוזמן! הוא ממתין ב<a href="/posts" className="underline font-semibold">מסך הפוסטים</a> (סטטוס: מתוזמן) — לא ברשימה שכאן, שמציגה רק פוסטים של טקסט חופשי. הפוסט יתפרסם ויוסר אוטומטית בסיום המבצע.
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-4">
          <div className="w-full sm:w-40 shrink-0">
            {selected.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={selected.image_url} alt={selected.title} className="w-full aspect-square object-contain bg-white/5 rounded-xl border border-edge" />
            )}
            <p className="text-xs text-white/60 mt-2 line-clamp-2">{selected.title}</p>
            {selected.sale_price > 0 && <p className="text-sm font-bold text-white mt-1">₪{selected.sale_price}</p>}
          </div>

          <div className="flex-1 min-w-0 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-2xs text-white/40 mb-1">אחוז הנחה (לא חובה)</label>
                <div className="relative">
                  <input type="number" min={0} max={99} value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="40"
                    className="w-full bg-white/5 border border-edge rounded-lg pl-7 pr-3 py-2 text-sm text-white outline-none focus:border-amber-500/50" />
                  <Percent size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30" />
                </div>
              </div>
              <div>
                <label className="block text-2xs text-white/40 mb-1">המבצע מסתיים ב-</label>
                <input aria-label="המבצע מסתיים ב-" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)}
                  className="w-full bg-white/5 border border-edge rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-amber-500/50" />
              </div>
            </div>

            {/* Product description → the AI writes about THIS even when the image/title misleads */}
            <div>
              <label className="block text-2xs text-white/40 mb-1">תיאור המוצר (אם ה-AI לא זיהה נכון מהתמונה)</label>
              <input aria-label="תיאור המוצר (אם ה-AI לא זיהה נכון מהתמונה)" value={hint} onChange={(e) => setHint(e.target.value)} placeholder="לדוגמה: חולצת פולו לקוסט כותנה, שרוול קצר"
                className="w-full bg-white/5 border border-edge rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-amber-500/50" />
              <p className="text-2xs text-white/30 mt-1">כתוב מה המוצר ולחץ "צור מחדש" — ה-AI יכתוב לפי התיאור הזה כמקור אמת.</p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-2xs text-white/40">טקסט הפוסט (ה-AI כתב — ערוך לפי הצורך)</label>
                <button onClick={() => generate()} disabled={generating}
                  className="flex items-center gap-1 text-2xs text-amber-400/80 hover:text-amber-300 disabled:opacity-50">
                  <RefreshCw size={11} className={generating ? 'animate-spin' : ''} /> צור מחדש
                </button>
              </div>
              {generating && !text ? (
                <div className="bg-white/5 border border-edge rounded-lg p-8 flex justify-center"><Loader2 size={18} className="animate-spin text-amber-400" /></div>
              ) : (
                <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8}
                  className="w-full bg-white/5 border border-edge rounded-lg px-3 py-2.5 text-sm text-white/85 outline-none focus:border-amber-500/50 resize-y" />
              )}
            </div>

            {/* Gallery — visual picker. Tap ✕ to remove, ‹ › to reorder, + to add back / add by URL.
                More than one image is sent as a swipeable Telegram album. */}
            <div>
              <label className="block text-2xs text-white/40 mb-1.5">
                תמונות · <span className={imagesArr.length ? 'text-amber-400/80' : 'text-red-400/80'}>{imagesArr.length}</span>/10 נבחרו
                {imagesArr.length > 1 && <span className="text-white/30"> · יישלח כאלבום</span>}
              </label>

              {imagesArr.length === 0 ? (
                <p className="text-2xs text-red-400/70 mb-2">אין תמונות — בחר לפחות אחת מהאפשרויות למטה.</p>
              ) : (
                <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 mb-2">
                  {imagesArr.map((url, i) => (
                    <div key={url} className="relative group aspect-square rounded-lg overflow-hidden border border-edge bg-white/5">
                      <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
                      {/* order badge */}
                      <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-black/70 text-white text-[9px] flex items-center justify-center font-medium">{i + 1}</span>
                      {/* remove */}
                      <button aria-label="הסר תמונה" type="button" onClick={() => removeImage(url)} title="הסר תמונה"
                        className="absolute top-1 left-1 w-4 h-4 rounded-full bg-red-500/90 hover:bg-red-500 text-white flex items-center justify-center">
                        <X size={10} />
                      </button>
                      {/* reorder */}
                      <div className="absolute bottom-0 inset-x-0 flex opacity-0 group-hover:opacity-100 transition-opacity">
                        <button aria-label="הקדם" type="button" onClick={() => moveImage(i, -1)} disabled={i === 0} title="הקדם"
                          className="flex-1 bg-black/60 hover:bg-black/80 text-white py-0.5 flex justify-center disabled:opacity-30"><ChevronRight size={12} /></button>
                        <button aria-label="אחר" type="button" onClick={() => moveImage(i, 1)} disabled={i === imagesArr.length - 1} title="אחר"
                          className="flex-1 bg-black/60 hover:bg-black/80 text-white py-0.5 flex justify-center disabled:opacity-30"><ChevronLeft size={12} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Re-add images removed from the product's own set */}
              {unusedPool.length > 0 && (
                <div className="mb-2">
                  <p className="text-2xs text-white/30 mb-1">תמונות נוספות של המוצר — הקש להוספה:</p>
                  <div className="grid grid-cols-6 sm:grid-cols-8 gap-1.5">
                    {unusedPool.map((url) => (
                      <button key={url} type="button" onClick={() => addImage(url)} disabled={imagesArr.length >= 10} title="הוסף"
                        className="relative aspect-square rounded-md overflow-hidden border border-edge bg-white/5 hover:border-amber-500/60 disabled:opacity-40 group">
                        <img src={url} alt="" className="w-full h-full object-cover opacity-60 group-hover:opacity-100" loading="lazy" />
                        <span className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/10">
                          <Plus size={14} className="text-white" />
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Add a custom image by URL */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <ImagePlus size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30" />
                  <input value={addUrl} onChange={(e) => setAddUrl(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addImage(addUrl.trim()); setAddUrl(''); } }}
                    placeholder="הדבק כתובת תמונה (https://...)" dir="ltr"
                    className="w-full bg-white/5 border border-edge rounded-lg pr-8 pl-3 py-2 text-xs text-white/80 outline-none focus:border-amber-500/50 font-mono" />
                </div>
                <button type="button" onClick={() => { addImage(addUrl.trim()); setAddUrl(''); }}
                  disabled={!addUrl.trim() || imagesArr.length >= 10}
                  className="px-3 py-2 bg-white/5 hover:bg-white/10 border border-edge rounded-lg text-2xs text-white/70 disabled:opacity-40 shrink-0">הוסף</button>
              </div>
              <p className="text-2xs text-white/30 mt-1">עד 10 תמונות · מוצרי FLYLINK מגיעים עם כל הצבעים/וריאציות.</p>
            </div>

            <div>
              <label className="block text-2xs text-white/40 mb-1.5">קבוצות יעד</label>
              <GroupMultiSelect channels={channels} value={channelIds} onChange={setChannelIds} disabled={scheduling} />
            </div>

            <div>
              <label className="block text-2xs text-white/40 mb-1">מתי לפרסם</label>
              <input aria-label="מתי לפרסם" type="datetime-local" value={sendAt} onChange={(e) => setSendAt(e.target.value)}
                className="w-full sm:w-64 bg-white/5 border border-edge rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-amber-500/50" />
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}

            <button onClick={schedule} disabled={scheduling || generating}
              className="flex items-center gap-2 px-5 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-all">
              {scheduling ? <Loader2 size={14} className="animate-spin" /> : <CalendarClock size={14} />}
              תזמן מבצע
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PICKER
  // ─────────────────────────────────────────────────────────────────────────────
  const SOURCES: { key: Source; label: string; icon: typeof Package }[] = [
    { key: 'flylink', label: 'FLYLINK', icon: Boxes },
    { key: 'catalog', label: 'הקטלוג שלי', icon: Package },
    { key: 'live', label: 'AliExpress חי', icon: Globe },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-amber-400 text-sm">
        <Clock size={15} /> בחר מוצר למבצע לזמן מוגבל
      </div>

      {/* Source toggle */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex bg-white/5 border border-edge-hover rounded-xl p-1 gap-1 w-fit overflow-x-auto max-w-full">
          {SOURCES.map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setSource(key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all ${source === key ? 'bg-amber-600/20 text-amber-300' : 'text-white/40 hover:text-white/70'}`}>
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>

        {/* FLYLINK: linked list vs browse a full catalog */}
        {source === 'flylink' && (
          <select value={flylinkSel} onChange={(e) => setFlylinkSel(e.target.value)}
            className="bg-white/5 border border-edge-hover rounded-xl px-3 py-2 text-xs text-white/80 outline-none focus:border-amber-500/50">
            <option value={LINKED}>המוצרים המקושרים שלי</option>
            {catalogs.map((c) => <option key={c.id} value={c.id}>דפדוף בקטלוג: {c.name}</option>)}
          </select>
        )}
      </div>

      {/* Search */}
      <form onSubmit={(e) => { e.preventDefault(); loadProducts(query); }} className="flex gap-2">
        <div className="relative flex-1">
          <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="חפש מוצר..."
            className="w-full bg-white/5 border border-edge-hover rounded-xl pr-10 pl-4 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-amber-500/50" />
        </div>
        <button type="submit" className="px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white text-sm rounded-xl">חפש</button>
      </form>

      {/* Link-a-new-album prompt (FLYLINK browse) */}
      {pendingAlbum && (
        <div className="bg-amber-500/5 border border-amber-500/25 rounded-xl p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {pendingAlbum.thumb && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={yupooImg(pendingAlbum.thumb)} alt="" className="w-14 h-14 object-cover rounded-lg border border-edge shrink-0" />
              )}
              <div className="min-w-0">
                <p className="text-sm text-white/85 truncate">{pendingAlbum.description || pendingAlbum.code}</p>
                <p className="text-2xs text-white/40">האלבום עוד לא מקושר — הדבק את קישור ה-FLYLINK שלו פעם אחת.</p>
              </div>
            </div>
            <button aria-label="סגור" onClick={() => setPendingAlbum(null)} className="text-white/40 hover:text-white/80 shrink-0"><X size={16} /></button>
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Link2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30" />
              <input value={flylinkInput} onChange={(e) => setFlylinkInput(e.target.value)} dir="ltr"
                placeholder="https://flylink.../product/..." autoFocus
                className="w-full bg-white/5 border border-edge rounded-lg pr-9 pl-3 py-2 text-xs text-white outline-none focus:border-amber-500/50" />
            </div>
            <button onClick={confirmLink} disabled={linking}
              className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg whitespace-nowrap">
              {linking ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />} קשר והמשך
            </button>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 size={22} className="animate-spin text-amber-400" /></div>
      ) : products.length === 0 ? (
        <p className="py-12 text-center text-sm text-white/40">לא נמצאו מוצרים במקור הזה.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
          {products.map((p) => <ProductCard key={p.product_id} product={p} onSelect={onCardSelect} isSelected={false} />)}
        </div>
      )}
    </div>
  );
}
