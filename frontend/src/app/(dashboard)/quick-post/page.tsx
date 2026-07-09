'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Search, Loader2, Zap, ChevronDown, TrendingUp,
  Percent, Globe, Languages, Tag, ArrowRight,
  ExternalLink, Copy, Check, RefreshCw, Package,
} from 'lucide-react';
import { ProductCard } from '@/components/products/ProductCard';
import { PostPreview } from '@/components/products/PostPreview';
import { ProductEditPanel } from '@/components/products/ProductEditPanel';
import { TemplatePanel } from '@/components/templates/TemplatePanel';
import { productsApi, postsApi, templatesApi, credentialsApi, catalogApi } from '@/lib/api-client';
import type { AliProduct, AliCategory, PostPreview as PostPreviewType, PostTemplate, CatalogProduct } from '@/types';

/** The quick-post grid renders AliProduct — adapt a catalog row to that shape. */
function catalogToAli(c: CatalogProduct): AliProduct {
  return {
    product_id: c.product_id,
    title: c.title,
    original_price: c.original_price,
    sale_price: c.sale_price,
    discount_percent: c.discount_percent,
    image_url: c.image_url,
    product_url: c.product_url,
    affiliate_url: c.affiliate_url,
    category: c.category,
    orders_count: c.orders_count,
    rating: c.rating,
    currency: c.currency,
  };
}

// ── Hebrew detection & translation ────────────────────────────────────────────

const HE_RE = /[\u0590-\u05FF]/;

async function translateHebrew(text: string): Promise<string> {
  if (!HE_RE.test(text)) return text;
  try {
    const res = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=he|en`,
    );
    const json = await res.json();
    const translated: string = json?.responseData?.translatedText || text;
    return translated.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
  } catch {
    return text;
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SORT_OPTIONS = [
  { value: 'best_selling',    label: 'נמכרים ביותר',    icon: TrendingUp },
  { value: 'most_discounted', label: 'הנחה גבוהה',      icon: Percent },
  { value: 'promotions',      label: 'מבצעי AliExpress', icon: Tag },
] as const;

type SortMode = typeof SORT_OPTIONS[number]['value'];

const POST_LANGS = [
  { value: 'he', label: 'עברית' },
  { value: 'en', label: 'English' },
  { value: 'ar', label: 'العربية' },
] as const;

type PostLang = typeof POST_LANGS[number]['value'];

const LIMIT = 30;

// ── Page ──────────────────────────────────────────────────────────────────────

export default function QuickPostPage() {
  const searchParams = useSearchParams();

  // ── View state: 'products' | 'review'
  const [view, setView] = useState<'products' | 'review'>('products');

  // ── Product source: the user's own catalog (instant, reliable, searchable) is
  // the DEFAULT; live AliExpress browsing is the secondary mode. This unifies the
  // flow with discovery: scan → catalog → quick-post from the catalog.
  const [source, setSource] = useState<'catalog' | 'live'>('catalog');

  // ── Product list state
  const [products, setProducts] = useState<AliProduct[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [isSearchMode, setIsSearchMode] = useState(false);

  // ── Search & filters
  const [query, setQuery] = useState('');
  const [translatedQuery, setTranslatedQuery] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [categories, setCategories] = useState<AliCategory[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>('best_selling');
  const [postLang, setPostLang] = useState<PostLang>('he');

  // ── Template state
  const [selectedTemplate, setSelectedTemplate] = useState<PostTemplate>({
    id: 'builtin_default', name: 'ברירת מחדל', icon: '✨', content: '', builtin: true,
  });

  // ── Review / post state
  const [selected, setSelected] = useState<AliProduct | null>(null);
  const [affiliateUrl, setAffiliateUrl] = useState('');
  const [affiliateLoading, setAffiliateLoading] = useState(false);
  const [affiliateCopied, setAffiliateCopied] = useState(false);
  const [preview, setPreview] = useState<PostPreviewType | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [posted, setPosted] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // ── Infinite scroll
  const sentinelRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // ── Load categories once
  useEffect(() => {
    productsApi.categories().then(setCategories).catch(() => {});
  }, []);

  // ── Pre-select the user's saved default body template
  useEffect(() => {
    Promise.all([credentialsApi.get(), templatesApi.list()])
      .then(([c, ts]) => {
        const id = c.default_body_template_id;
        if (!id || id === 'builtin_default') return;
        const t = ts.find((x) => x.id === id);
        if (t) setSelectedTemplate({ ...t, builtin: false });
      })
      .catch(() => {});
  }, []);

  // ── Pre-load catalog product (from /products page "צור פוסט")
  useEffect(() => {
    if (searchParams.get('from_catalog') !== '1') return;
    try {
      const raw = sessionStorage.getItem('quick_post_catalog_product');
      if (!raw) return;
      sessionStorage.removeItem('quick_post_catalog_product');
      const product: AliProduct = JSON.parse(raw);
      setSelected(product);
      setPreview(null);
      setAffiliateUrl('');
      setView('review');
      // Always generate the short affiliate link (catalog links may be raw URLs).
      setAffiliateLoading(true);
      productsApi.affiliateLink(product.product_id)
        .then((res) => setAffiliateUrl(res.url))
        .catch(() => setAffiliateUrl(product.affiliate_url || product.product_url || ''))
        .finally(() => setAffiliateLoading(false));
    } catch {
      // ignore parse errors
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load the user's own catalog (default source — instant, from our DB)
  const loadCatalog = useCallback(async (nextPage: number, append: boolean, search?: string) => {
    if (nextPage === 1 && !append) setLoadingInitial(true);
    else setLoadingMore(true);
    try {
      const res = await catalogApi.list({ page: nextPage, limit: LIMIT, search: search?.trim() || undefined });
      const mapped = res.data.map(catalogToAli);
      setProducts((prev) => append ? [...prev, ...mapped] : mapped);
      setHasMore(nextPage * LIMIT < res.total);
      setPage(nextPage);
      // Empty catalog and no active search → live browsing is more useful.
      if (!append && !search && res.total === 0) setSource('live');
    } finally {
      setLoadingInitial(false);
      setLoadingMore(false);
    }
  }, []);

  // ── Load featured products
  const loadFeatured = useCallback(async (nextPage: number, append: boolean) => {
    if (nextPage === 1 && !append) setLoadingInitial(true);
    else setLoadingMore(true);
    try {
      const res = sortMode === 'promotions'
        ? await productsApi.promotional({ category_id: selectedCategory || undefined, page: nextPage, limit: LIMIT })
        : await productsApi.featured({ category_id: selectedCategory || undefined, sort: sortMode as 'best_selling' | 'most_discounted', page: nextPage, limit: LIMIT });
      setProducts((prev) => append ? [...prev, ...res.data] : res.data);
      setHasMore(res.data.length === LIMIT);
      setPage(nextPage);
    } catch {
      // Live AliExpress browsing can time out — never leave a silent empty grid.
      if (!append) { setProducts([]); setHasMore(false); }
    } finally {
      setLoadingInitial(false);
      setLoadingMore(false);
    }
  }, [selectedCategory, sortMode]);

  useEffect(() => {
    if (source === 'catalog') { loadCatalog(1, false, isSearchMode ? query : undefined); return; }
    if (!isSearchMode) loadFeatured(1, false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, isSearchMode, loadFeatured, loadCatalog]);

  // ── Run search
  const runSearch = useCallback(async (nextPage: number, append: boolean, keyword: string) => {
    if (nextPage === 1 && !append) setLoadingInitial(true);
    else setLoadingMore(true);
    try {
      const res = await productsApi.search({
        keyword, category_id: selectedCategory || undefined,
        sort: sortMode === 'best_selling' ? 'LAST_VOLUME_DESC' : 'SALE_PRICE_ASC',
        page: nextPage, limit: LIMIT,
      });
      setProducts((prev) => append ? [...prev, ...res.data] : res.data);
      setHasMore(res.data.length === LIMIT);
      setPage(nextPage);
    } finally {
      setLoadingInitial(false);
      setLoadingMore(false);
    }
  }, [selectedCategory, sortMode]);

  // ── Search submit
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    // Catalog search runs against our own DB — instant, no translation needed.
    if (source === 'catalog') {
      setIsSearchMode(true);
      loadCatalog(1, false, query.trim());
      return;
    }

    setIsTranslating(HE_RE.test(query));
    const english = await translateHebrew(query.trim());
    setTranslatedQuery(english !== query.trim() ? english : '');
    setIsTranslating(false);
    setIsSearchMode(true);
    runSearch(1, false, english);
  };

  const handleClearSearch = () => {
    setQuery('');
    setTranslatedQuery('');
    setIsSearchMode(false);
    if (source === 'catalog') loadCatalog(1, false);
  };

  const handleSourceChange = (s: 'catalog' | 'live') => {
    if (s === source) return;
    setSource(s);
    setQuery('');
    setTranslatedQuery('');
    setIsSearchMode(false);
    setProducts([]);
  };

  const handleCategoryChange = (catId: string) => {
    setSelectedCategory(catId);
    if (isSearchMode && query) runSearch(1, false, translatedQuery || query);
  };

  const handleSortChange = (s: SortMode) => setSortMode(s);

  // ── Infinite scroll
  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();
    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loadingMore && !loadingInitial) {
          const nextPage = page + 1;
          if (source === 'catalog') loadCatalog(nextPage, true, isSearchMode ? query : undefined);
          else if (isSearchMode) runSearch(nextPage, true, translatedQuery || query);
          else loadFeatured(nextPage, true);
        }
      },
      { threshold: 0.5 },
    );
    if (sentinelRef.current) observerRef.current.observe(sentinelRef.current);
    return () => observerRef.current?.disconnect();
  }, [hasMore, loadingMore, loadingInitial, page, isSearchMode, translatedQuery, query, source, runSearch, loadFeatured, loadCatalog]);

  // ── Select product → go to review view (NO refreshPrice — it returns wrong products)
  const handleSelect = async (product: AliProduct) => {
    setSelected(product);
    setPreview(null);
    setView('review');

    // Generate the SHORT affiliate link (s.click.aliexpress.com/e/_xxx) via
    // link.generate. The product's inline promotion_link is the long /s/ form,
    // so it's only a fallback if generation fails.
    setAffiliateUrl('');
    setAffiliateLoading(true);
    try {
      const res = await productsApi.affiliateLink(product.product_id);
      setAffiliateUrl(res.url);
    } catch {
      setAffiliateUrl(product.affiliate_url || product.product_url);
    } finally {
      setAffiliateLoading(false);
    }
  };

  const handleBackToProducts = () => {
    setView('products');
    setSelected(null);
    setPreview(null);
    setAffiliateUrl('');
  };

  const copyAffiliateUrl = () => {
    if (!affiliateUrl) return;
    navigator.clipboard.writeText(affiliateUrl);
    setAffiliateCopied(true);
    setTimeout(() => setAffiliateCopied(false), 2000);
  };

  // ── Generate preview
  const handleGenerate = async (editedProduct: AliProduct & { price_ils: number }) => {
    setIsLoadingPreview(true);
    setPreviewError(null);
    try {
      const p = await postsApi.preview(editedProduct.product_id, postLang, editedProduct, selectedTemplate.content || undefined);
      // Append affiliate link if available and not already in text
      if (affiliateUrl && !p.generated_text.includes(affiliateUrl)) {
        p.generated_text = p.generated_text + '\n\n🔗 ' + affiliateUrl;
      }
      setPreview(p);
    } catch (e: any) {
      // Surface the real reason instead of the button silently doing nothing.
      const msg = e?.code === 'ECONNABORTED'
        ? 'יצירת הפוסט ארכה יותר מדי (ייתכן שהשרת התעורר מ-sleep) — נסה שוב'
        : e?.response?.data?.message || 'יצירת הפוסט נכשלה — נסה שוב';
      setPreviewError(msg);
    } finally {
      setIsLoadingPreview(false);
    }
  };

  // ── Regenerate when language or template changes
  useEffect(() => {
    if (!selected || !preview) return;
    setIsLoadingPreview(true);
    postsApi.preview(selected.product_id, postLang, preview.product as any, selectedTemplate.content || undefined)
      .then(setPreview)
      .catch(() => {})
      .finally(() => setIsLoadingPreview(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postLang, selectedTemplate.id]);

  const handlePost = async (text: string) => {
    if (!selected) return;
    setIsPosting(true);
    try {
      await postsApi.quickPost({
        product_id: selected.product_id,
        text,
        // Pass the image and affiliate link so the backend uses the correct product image
        // instead of re-fetching via searchProduct (which returns wrong results)
        product_image: preview?.product?.image_url || selected.image_url || undefined,
        affiliate_url: affiliateUrl || undefined,
      });
      setPosted(true);
      setTimeout(() => { setPosted(false); handleBackToProducts(); }, 3000);
    } finally {
      setIsPosting(false);
    }
  };

  const handleSchedule = async (text: string, scheduledAt: string) => {
    if (!selected) return;
    await postsApi.schedulePost({
      product_id: selected.product_id,
      text,
      scheduled_at: scheduledAt,
      product_image: preview?.product?.image_url || selected.image_url || undefined,
      affiliate_url: affiliateUrl || undefined,
    });
    setPosted(true);
    setTimeout(() => { setPosted(false); handleBackToProducts(); }, 3000);
  };

  // One-click queue: send time is decided automatically by the user's schedule
  // settings (window + interval) — no manual date picking needed.
  const handleQueue = async (text: string) => {
    const p = preview?.product || selected!;
    return postsApi.addToQueue({
      product_id: p.product_id,
      title: p.title,
      image_url: p.image_url,
      affiliate_url: affiliateUrl || p.affiliate_url || '',
      sale_price: p.sale_price,
      original_price: p.original_price,
      currency: p.currency,
      discount_percent: p.discount_percent,
      orders_count: p.orders_count,
      rating: p.rating,
    }, text);
  };

  const handleRegenerate = async () => {
    if (!selected) return;
    setIsRegenerating(true);
    try {
      const p = await postsApi.preview(selected.product_id, postLang, preview?.product as any, selectedTemplate.content || undefined);
      if (affiliateUrl && !p.generated_text.includes(affiliateUrl)) {
        p.generated_text = p.generated_text + '\n\n🔗 ' + affiliateUrl;
      }
      setPreview(p);
    } finally {
      setIsRegenerating(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // REVIEW VIEW
  // ─────────────────────────────────────────────────────────────────────────────

  if (view === 'review' && selected) {
    return (
      <div>
        {/* Header */}
        <div className="mb-6 flex items-center gap-4">
          <button
            onClick={handleBackToProducts}
            className="flex items-center gap-2 text-white/50 hover:text-white/90 text-sm transition-colors"
          >
            <ArrowRight size={16} />
            חזרה למוצרים
          </button>
          <div className="h-4 w-px bg-white/10" />
          <div>
            <div className="flex items-center gap-2 text-white/30 text-xs mb-0.5">
              <Zap size={12} />
              <span>פוסט מהיר › בדיקה ועריכה</span>
            </div>
            <h1 className="text-xl font-bold text-white truncate max-w-xl">{selected.title}</h1>
          </div>
        </div>

        {/* Success banner */}
        {posted && (
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 text-sm text-emerald-400 text-center mb-6">
            ✅ הפוסט נשמר בהצלחה!
          </div>
        )}

        {/* Main review layout */}
        <div className="flex flex-col lg:flex-row gap-5 items-stretch lg:items-start">

          {/* Left: product image + affiliate link */}
          <div className="w-72 shrink-0 space-y-3">
            {/* Product image */}
            <div className="bg-surface-secondary border border-edge rounded-xl overflow-hidden">
              {selected.image_url && (
                <div className="aspect-square bg-white/5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={selected.image_url}
                    alt={selected.title}
                    className="w-full h-full object-contain"
                  />
                </div>
              )}
              <div className="p-3">
                <a
                  href={selected.product_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-2 bg-[#e8590c]/10 hover:bg-[#e8590c]/20 border border-[#e8590c]/20 hover:border-[#e8590c]/40 text-[#e8590c] text-xs font-medium rounded-lg transition-all"
                >
                  <ExternalLink size={12} />
                  צפה באלי-אקספרס
                </a>
              </div>
            </div>

            {/* Affiliate link box */}
            <div className="bg-surface-secondary border border-edge rounded-xl p-4 space-y-2">
              <p className="text-2xs font-semibold text-white/40 uppercase tracking-wider flex items-center gap-1.5">
                <RefreshCw size={9} className={affiliateLoading ? 'animate-spin' : ''} />
                קישור שותפים
              </p>
              {affiliateLoading ? (
                <div className="flex items-center gap-2 text-xs text-white/30">
                  <Loader2 size={12} className="animate-spin" />
                  טוען קישור...
                </div>
              ) : affiliateUrl ? (
                <>
                  <div className="bg-white/5 border border-edge rounded-lg px-3 py-2">
                    <p className="text-xs text-white/50 break-all" dir="ltr">{affiliateUrl}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={copyAffiliateUrl}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/80 text-xs rounded-lg transition-all"
                    >
                      {affiliateCopied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                      {affiliateCopied ? 'הועתק!' : 'העתק'}
                    </button>
                    <a
                      href={affiliateUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/80 text-xs rounded-lg transition-all"
                    >
                      <ExternalLink size={11} />
                      פתח
                    </a>
                  </div>
                </>
              ) : (
                <p className="text-xs text-white/25">לא ניתן לטעון קישור שותפים</p>
              )}
            </div>

            {/* Template panel */}
            <TemplatePanel
              selectedId={selectedTemplate.id}
              onSelect={setSelectedTemplate}
            />
          </div>

          {/* Center: edit panel */}
          <div className="flex-1 min-w-0 space-y-4">
            {/* Language selector */}
            <div className="flex items-center gap-2">
              <Globe size={13} className="text-white/30" />
              <span className="text-xs text-white/40">שפת פוסט:</span>
              <div className="flex bg-surface-secondary border border-edge-hover rounded-xl p-1 gap-0.5">
                {POST_LANGS.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setPostLang(value)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all
                      ${postLang === value ? 'bg-white/10 text-white' : 'text-white/30 hover:text-white/60'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Edit panel */}
            <ProductEditPanel
              product={selected}
              rate={1}
              activeTemplate={selectedTemplate}
              onGenerate={handleGenerate}
              onClose={handleBackToProducts}
              isGenerating={isLoadingPreview}
            />

            {/* Preview loading */}
            {isLoadingPreview && !preview && (
              <div className="bg-surface-secondary border border-edge rounded-xl p-10 flex justify-center">
                <Loader2 size={20} className="animate-spin text-blue-400" />
              </div>
            )}

            {/* Preview error */}
            {previewError && !isLoadingPreview && (
              <div className="bg-red-500/10 border border-red-500/25 text-red-300 text-sm rounded-xl px-4 py-3">
                {previewError}
              </div>
            )}

            {/* Post preview */}
            {preview && !isLoadingPreview && (
              <div>
                <p className="text-xs text-white/30 mb-3">תצוגה מקדימה — Telegram</p>
                <PostPreview
                  preview={preview}
                  onPost={handlePost}
                  onSchedule={handleSchedule}
                  onRegenerate={handleRegenerate}
                  onQueue={handleQueue}
                  isPosting={isPosting}
                  isRegenerating={isRegenerating}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PRODUCTS VIEW
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-white/30 text-xs mb-1">
          <Zap size={12} />
          <span>פוסט מהיר</span>
        </div>
        <h1 className="text-2xl font-bold text-white">בחר מוצר</h1>
        <p className="text-sm text-white/40 mt-1">בחר מוצר כדי לערוך ולפרסם אותו בטלגרם</p>
      </div>

      {/* Source toggle: my catalog (default, instant) vs live AliExpress browsing */}
      <div className="flex bg-surface-secondary border border-edge-hover rounded-xl p-1 gap-1 mb-4 w-fit">
        <button
          onClick={() => handleSourceChange('catalog')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all
            ${source === 'catalog' ? 'bg-blue-600/20 text-blue-400' : 'text-white/40 hover:text-white/70'}`}
        >
          <Package size={13} />
          הקטלוג שלי
        </button>
        <button
          onClick={() => handleSourceChange('live')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all
            ${source === 'live' ? 'bg-blue-600/20 text-blue-400' : 'text-white/40 hover:text-white/70'}`}
        >
          <Globe size={13} />
          חיפוש חי ב-AliExpress
        </button>
      </div>

      {/* Search + filters */}
      <div className="space-y-3 mb-6">
        <form onSubmit={handleSearch} className="flex gap-3">
          <div className="relative flex-1">
            <Search size={15} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="חפש מוצר... (עברית או English)"
              className="w-full bg-surface-secondary border border-edge-hover rounded-xl pr-11 pl-4 py-3 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/60 transition-colors"
            />
            {isTranslating && (
              <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-xs text-blue-400">
                <Loader2 size={11} className="animate-spin" /> מתרגם...
              </div>
            )}
          </div>
          <button
            type="submit"
            disabled={!query.trim() || loadingInitial}
            className="px-5 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-all flex items-center gap-2"
          >
            {loadingInitial && isSearchMode ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            חפש
          </button>
          {isSearchMode && (
            <button type="button" onClick={handleClearSearch} className="px-4 py-3 bg-white/5 hover:bg-white/10 text-white/50 text-sm rounded-xl transition-all">
              נקה
            </button>
          )}
        </form>

        {translatedQuery && (
          <div className="flex items-center gap-2 text-xs text-blue-400/70 bg-blue-500/5 border border-blue-500/10 rounded-lg px-3 py-2">
            <Languages size={12} />
            <span>תורגם ל: <span className="font-medium text-blue-400">"{translatedQuery}"</span></span>
          </div>
        )}

        {source === 'live' && <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <select
              value={selectedCategory}
              onChange={(e) => handleCategoryChange(e.target.value)}
              className="appearance-none bg-surface-secondary border border-edge-hover rounded-xl px-4 py-2 pr-8 text-sm text-white/70 outline-none focus:border-blue-500/50 transition-colors cursor-pointer"
            >
              <option value="">כל הקטגוריות</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <ChevronDown size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
          </div>

          <div className="flex bg-surface-secondary border border-edge-hover rounded-xl p-1 gap-1">
            {SORT_OPTIONS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => handleSortChange(value)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                  ${sortMode === value ? 'bg-blue-600/20 text-blue-400' : 'text-white/40 hover:text-white/70'}`}
              >
                <Icon size={12} />
                {label}
              </button>
            ))}
          </div>
        </div>}
      </div>

      {/* Section label */}
      <div className="flex items-center gap-2 mb-4">
        {isSearchMode ? (
          <>
            <Search size={13} className="text-white/30" />
            <span className="text-xs text-white/30">
              תוצאות עבור "{query}"
              {translatedQuery && ` (${translatedQuery})`}
              {products.length > 0 && ` — ${products.length} מוצרים`}
            </span>
          </>
        ) : source === 'catalog' ? (
          <>
            <Package size={13} className="text-blue-400" />
            <span className="text-xs text-white/40">
              המוצרים מהקטלוג שלך
              {products.length > 0 && ` — ${products.length} מוצרים`}
            </span>
          </>
        ) : (
          <>
            {sortMode === 'best_selling' && <TrendingUp size={13} className="text-blue-400" />}
            {sortMode === 'most_discounted' && <Percent size={13} className="text-amber-400" />}
            {sortMode === 'promotions' && <Tag size={13} className="text-orange-400" />}
            <span className="text-xs text-white/40">
              {sortMode === 'best_selling' && 'מוצרים נמכרים'}
              {sortMode === 'most_discounted' && 'הנחות הגבוהות ביותר'}
              {sortMode === 'promotions' && 'מבצעי AliExpress — קמפיינים פעילים'}
              {selectedCategory && categories.length > 0 ? ` · ${categories.find((c) => c.id === selectedCategory)?.name}` : ''}
              {products.length > 0 && ` — ${products.length} מוצרים`}
            </span>
          </>
        )}
      </div>

      {/* Products grid */}
      {loadingInitial ? (
        <div className="flex justify-center py-20">
          <Loader2 size={24} className="animate-spin text-blue-400" />
        </div>
      ) : products.length === 0 ? (
        <div className="bg-surface-secondary border border-dashed border-edge-hover rounded-2xl p-16 flex flex-col items-center text-center">
          <Search size={36} className="text-white/15 mb-4" />
          <p className="text-sm text-white/30">לא נמצאו מוצרים</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
            {products.map((p) => (
              <ProductCard
                key={p.product_id}
                product={p}
                onSelect={handleSelect}
                isSelected={false}
              />
            ))}
          </div>

          <div ref={sentinelRef} className="mt-6 flex justify-center py-4">
            {loadingMore && (
              <div className="flex items-center gap-2 text-sm text-white/30">
                <Loader2 size={16} className="animate-spin" />
                טוען עוד מוצרים...
              </div>
            )}
            {!loadingMore && !hasMore && products.length > 0 && (
              <p className="text-xs text-white/20">הגעת לסוף הרשימה</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
