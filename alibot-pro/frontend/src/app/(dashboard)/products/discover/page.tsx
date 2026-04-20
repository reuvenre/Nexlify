'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Search, ChevronRight, Flame, SlidersHorizontal, X,
  ShoppingCart, Star, Package, Loader2, CheckCircle2,
  RefreshCw, LayoutGrid, List, ArrowUpDown, ChevronDown,
  Zap, Tag, Plus,
} from 'lucide-react';
import { productsApi, catalogApi } from '@/lib/api-client';
import type { AliProduct } from '@/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const SYMS: Record<string, string> = { ILS: '₪', EUR: '€', GBP: '£', USD: '$' };
const sym = (c = 'ILS') => SYMS[c] || '₪';

// Commission rate shown on AliExpress affiliate products
const DEFAULT_COMMISSION = 8.0;

const PRESET_KEYWORDS = [
  'tactical gear', 'smart watch', 'wireless earbuds', 'phone case',
  'home decor', 'outdoor tools', 'women fashion', 'kids toys',
  'LED lights', 'fitness equipment', 'car accessories',
];

const SORT_OPTIONS = [
  { value: 'best_selling',    label: 'מוכרים ביותר' },
  { value: 'most_discounted', label: 'הנחה הגדולה ביותר' },
  { value: 'price_asc',       label: 'מחיר: נמוך לגבוה' },
  { value: 'price_desc',      label: 'מחיר: גבוה לנמוך' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calcCommission(price: number, rate = DEFAULT_COMMISSION) {
  return +(price * rate / 100).toFixed(2);
}

function fmtPrice(n: number) {
  return n.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function fmtOrders(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

// ─── Add-to-catalog button state per product ──────────────────────────────────

type AddState = 'idle' | 'loading' | 'done' | 'error';

// ─── Product Card ─────────────────────────────────────────────────────────────

function ProductCard({
  product,
  view,
}: {
  product: AliProduct;
  view: 'grid' | 'list';
}) {
  const [state, setState] = useState<AddState>('idle');
  const commission = calcCommission(product.sale_price, DEFAULT_COMMISSION);
  const s = sym(product.currency);
  const hasDiscount = product.discount_percent > 0;

  async function handleAdd() {
    if (state !== 'idle') return;
    setState('loading');
    try {
      await catalogApi.importProduct({ product_id: product.product_id });
      setState('done');
    } catch (err: any) {
      const msg: string = err?.response?.data?.message || '';
      // If already exists, treat as done
      if (msg.includes('קיים') || msg.includes('exist') || err?.response?.status === 409) {
        setState('done');
      } else {
        setState('error');
        setTimeout(() => setState('idle'), 2500);
      }
    }
  }

  if (view === 'list') {
    return (
      <div className="flex items-center gap-4 px-5 py-3.5 border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors group">
        {/* Image */}
        <div className="relative w-14 h-14 rounded-xl overflow-hidden bg-white/[0.04] shrink-0">
          {product.image_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={product.image_url} alt={product.title} className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Package size={18} className="text-white/15" />
            </div>
          )}
          {hasDiscount && (
            <span className="absolute top-1 right-1 px-1 py-0.5 bg-red-500 text-white text-[9px] font-bold rounded-md leading-none">
              -{product.discount_percent}%
            </span>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-[13px] text-white/80 line-clamp-1 leading-snug">{product.title}</p>
          <div className="flex items-center gap-3 mt-1">
            {product.rating > 0 && (
              <span className="flex items-center gap-0.5">
                <Star size={9} className="text-amber-400 fill-amber-400" />
                <span className="text-[10px] text-white/40">{product.rating.toFixed(1)}</span>
              </span>
            )}
            {product.orders_count > 0 && (
              <span className="text-[10px] text-white/30">{fmtOrders(product.orders_count)} הזמנות</span>
            )}
            <span className="text-[10px] text-white/25">{product.category}</span>
          </div>
        </div>

        {/* Price */}
        <div className="text-right shrink-0">
          <p className="text-[15px] font-bold text-white">{s}{fmtPrice(product.sale_price)}</p>
          {hasDiscount && (
            <p className="text-[10px] text-white/25 line-through">{s}{fmtPrice(product.original_price)}</p>
          )}
        </div>

        {/* Commission */}
        <div className="text-right shrink-0 w-24">
          <p className="text-[12px] text-emerald-400 font-medium">{DEFAULT_COMMISSION}%</p>
          <p className="text-[10px] text-emerald-400/55">{s}{fmtPrice(commission)} עמלה</p>
        </div>

        {/* Add button */}
        <button
          onClick={handleAdd}
          disabled={state !== 'idle'}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-[12px] font-semibold transition-all shrink-0 min-w-[110px] justify-center
            ${state === 'done'
              ? 'bg-emerald-600/15 border border-emerald-500/30 text-emerald-400 cursor-default'
              : state === 'error'
              ? 'bg-red-500/10 border border-red-500/20 text-red-400 cursor-default'
              : 'bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white'
            }`}
        >
          {state === 'loading' ? (
            <><Loader2 size={12} className="animate-spin" />מוסיף...</>
          ) : state === 'done' ? (
            <><CheckCircle2 size={12} />נוסף!</>
          ) : state === 'error' ? (
            <>שגיאה</>
          ) : (
            <><ShoppingCart size={12} />הוסף מוצר</>
          )}
        </button>
      </div>
    );
  }

  // Grid card
  return (
    <div className="group bg-[#0e1016] border border-white/[0.06] rounded-2xl overflow-hidden hover:border-white/[0.12] hover:shadow-xl hover:shadow-black/30 transition-all duration-200 flex flex-col">
      {/* Image area */}
      <div className="relative aspect-square overflow-hidden bg-[#13151f]">
        {product.image_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={product.image_url}
            alt={product.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Package size={36} className="text-white/10" />
          </div>
        )}

        {/* Commission badge top-right */}
        <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 bg-black/70 backdrop-blur-sm rounded-full border border-white/10">
          <Flame size={9} className="text-orange-400 fill-orange-400" />
          <span className="text-[10px] font-bold text-orange-300">{DEFAULT_COMMISSION}%</span>
        </div>

        {/* Discount badge top-left */}
        {hasDiscount && (
          <div className="absolute top-2 left-2 px-2 py-0.5 bg-red-500 rounded-full">
            <span className="text-[10px] font-bold text-white">-{product.discount_percent}%</span>
          </div>
        )}

        {/* Orders overlay at bottom */}
        {product.orders_count > 100 && (
          <div className="absolute bottom-0 left-0 right-0 px-3 py-1.5 bg-gradient-to-t from-black/80 to-transparent">
            <p className="text-[10px] text-white/60">
              <span className="text-white/80 font-medium">{fmtOrders(product.orders_count)}</span> הזמנות
            </p>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-3 flex flex-col flex-1">
        {/* Title */}
        <p className="text-[12px] text-white/75 line-clamp-2 leading-snug mb-2 flex-1">
          {product.title}
        </p>

        {/* Rating */}
        {product.rating > 0 && (
          <div className="flex items-center gap-1 mb-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Star
                key={i}
                size={9}
                className={i < Math.round(product.rating) ? 'text-amber-400 fill-amber-400' : 'text-white/15'}
              />
            ))}
            <span className="text-[9px] text-white/35 mr-0.5">{product.rating.toFixed(1)}</span>
          </div>
        )}

        {/* Price row */}
        <div className="flex items-end justify-between mb-1">
          <div>
            <p className="text-[17px] font-bold text-white leading-none">
              {s}{fmtPrice(product.sale_price)}
            </p>
            {hasDiscount && (
              <p className="text-[10px] text-white/30 line-through mt-0.5">
                {s}{fmtPrice(product.original_price)}
              </p>
            )}
          </div>
        </div>

        {/* Commission row */}
        <div className="flex items-center gap-1.5 mb-3 px-2 py-1.5 bg-emerald-500/[0.07] border border-emerald-500/[0.15] rounded-lg">
          <Tag size={9} className="text-emerald-400 shrink-0" />
          <span className="text-[10px] text-emerald-400/80">עמלה:</span>
          <span className="text-[10px] font-semibold text-emerald-400">{s}{fmtPrice(commission)}</span>
          <span className="text-[9px] text-emerald-400/55 mr-auto">{DEFAULT_COMMISSION}%</span>
        </div>

        {/* Add button */}
        <button
          onClick={handleAdd}
          disabled={state !== 'idle'}
          className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[12px] font-semibold transition-all
            ${state === 'done'
              ? 'bg-emerald-600/15 border border-emerald-500/30 text-emerald-400 cursor-default'
              : state === 'error'
              ? 'bg-red-500/10 border border-red-500/20 text-red-400 cursor-default'
              : 'bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white shadow-sm shadow-blue-600/30'
            }`}
        >
          {state === 'loading' ? (
            <><Loader2 size={13} className="animate-spin" />מוסיף...</>
          ) : state === 'done' ? (
            <><CheckCircle2 size={13} />נוסף לקטלוג!</>
          ) : state === 'error' ? (
            <>שגיאה, נסה שוב</>
          ) : (
            <><ShoppingCart size={13} />הוסף מוצר</>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Discover Page ────────────────────────────────────────────────────────────

export default function DiscoverPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [activeTab, setActiveTab] = useState<'search' | 'hot'>('hot');
  const [view, setView] = useState<'grid' | 'list'>('grid');

  // Search state
  const [keywords, setKeywords] = useState<string[]>([]);
  const [kwInput, setKwInput] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [minDiscount, setMinDiscount] = useState('');
  const [sort, setSort] = useState<string>('best_selling');
  const [showSortMenu, setShowSortMenu] = useState(false);

  // Results state
  const [products, setProducts] = useState<AliProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const LIMIT = 20;
  const sortMenuRef = useRef<HTMLDivElement>(null);

  // Close sort menu on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setShowSortMenu(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // On mount, load hot products by default
  useEffect(() => {
    loadHot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadHot(p = 1) {
    setLoading(true);
    setSearched(true);
    try {
      const res = await productsApi.featured({
        sort: 'best_selling',
        page: p,
        limit: LIMIT,
      });
      setProducts(res.data);
      setTotal(res.total);
      setPage(p);
    } catch {
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadSearch(p = 1) {
    if (keywords.length === 0) return;
    setLoading(true);
    setSearched(true);
    try {
      const res = await productsApi.search({
        keyword: keywords.join(' '),
        min_price: minPrice ? +minPrice : undefined,
        max_price: maxPrice ? +maxPrice : undefined,
        min_discount: minDiscount ? +minDiscount : undefined,
        sort: sort === 'best_selling' || sort === 'most_discounted' ? sort : undefined,
        page: p,
        limit: LIMIT,
      });
      setProducts(res.data);
      setTotal(res.total);
      setPage(p);
    } catch {
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }

  function addKeyword(kw: string) {
    const trimmed = kw.trim();
    if (!trimmed || keywords.includes(trimmed)) return;
    setKeywords((prev) => [...prev, trimmed]);
    setKwInput('');
  }

  function removeKeyword(kw: string) {
    setKeywords((prev) => prev.filter((k) => k !== kw));
  }

  function handleTabSwitch(tab: 'search' | 'hot') {
    setActiveTab(tab);
    setProducts([]);
    setSearched(false);
    if (tab === 'hot') {
      loadHot();
    }
  }

  function handleSearch() {
    if (keywords.length === 0) return;
    loadSearch(1);
  }

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div style={{ direction: 'rtl' }}>

      {/* ── Breadcrumb ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-5">
        <button
          onClick={() => router.push('/products')}
          className="flex items-center gap-1.5 text-[12px] text-white/40 hover:text-white/70 transition-colors"
        >
          <ChevronRight size={13} />
          מוצרים
        </button>
        <span className="text-white/20">/</span>
        <span className="text-[12px] text-white/65">גלה מוצרים</span>
      </div>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-white tracking-tight">גלה מוצרים</h1>
          <p className="text-[13px] text-white/35 mt-1">חפש מוצרים מ-AliExpress והוסף לקטלוג שלך בלחיצה</p>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-[#0e1016] border border-white/[0.06] rounded-xl p-1">
          <button
            onClick={() => handleTabSwitch('hot')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-all ${
              activeTab === 'hot'
                ? 'bg-orange-500/15 border border-orange-500/25 text-orange-400'
                : 'text-white/35 hover:text-white/65 hover:bg-white/[0.04]'
            }`}
          >
            <Flame size={13} className={activeTab === 'hot' ? 'text-orange-400 fill-orange-400' : 'text-white/25'} />
            Hot Products
          </button>
          <button
            onClick={() => handleTabSwitch('search')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-all ${
              activeTab === 'search'
                ? 'bg-blue-600/15 border border-blue-500/25 text-blue-400'
                : 'text-white/35 hover:text-white/65 hover:bg-white/[0.04]'
            }`}
          >
            <Search size={13} />
            חיפוש מוצרים
          </button>
        </div>
      </div>

      {/* ── Search Panel ─────────────────────────────────────────────────── */}
      {activeTab === 'search' && (
        <div className="bg-[#0e1016] border border-white/[0.07] rounded-2xl p-5 mb-6">

          {/* Keyword chips + input */}
          <div className="flex items-center flex-wrap gap-2 mb-4">
            <span className="text-[12px] text-white/35 shrink-0">מילות מפתח:</span>
            {keywords.map((kw) => (
              <span
                key={kw}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/[0.12] border border-blue-500/25 rounded-full text-[12px] text-blue-300 font-medium"
              >
                {kw}
                <button
                  onClick={() => removeKeyword(kw)}
                  className="text-blue-400/50 hover:text-blue-300 transition-colors leading-none"
                >
                  <X size={11} />
                </button>
              </span>
            ))}
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <input
                type="text"
                value={kwInput}
                onChange={(e) => setKwInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); addKeyword(kwInput); }
                  if (e.key === ',') { e.preventDefault(); addKeyword(kwInput); }
                }}
                placeholder="הוסף מילת מפתח (Enter לאישור)..."
                className="flex-1 bg-[#13151f] border border-white/[0.08] rounded-xl px-3.5 py-2 text-[13px] text-white/75 placeholder-white/20 outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition-all"
              />
            </div>
          </div>

          {/* Preset keywords */}
          {keywords.length === 0 && (
            <div className="flex items-center flex-wrap gap-1.5 mb-4">
              <span className="text-[11px] text-white/25 shrink-0">הצעות:</span>
              {PRESET_KEYWORDS.map((kw) => (
                <button
                  key={kw}
                  onClick={() => addKeyword(kw)}
                  className="px-2.5 py-1 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] hover:border-white/[0.12] rounded-full text-[11px] text-white/45 hover:text-white/70 transition-all"
                >
                  + {kw}
                </button>
              ))}
            </div>
          )}

          {/* Filters row */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-[12px] font-medium border transition-all ${
                showFilters
                  ? 'bg-white/[0.08] border-white/[0.14] text-white/80'
                  : 'bg-white/[0.03] border-white/[0.07] text-white/45 hover:text-white/70 hover:bg-white/[0.06]'
              }`}
            >
              <SlidersHorizontal size={13} />
              מסננים
              {(minPrice || maxPrice || minDiscount) && (
                <span className="w-4 h-4 bg-blue-500 rounded-full text-[9px] text-white flex items-center justify-center">
                  {[minPrice, maxPrice, minDiscount].filter(Boolean).length}
                </span>
              )}
            </button>

            <div className="flex items-center gap-2">
              {/* Sort */}
              <div className="relative" ref={sortMenuRef}>
                <button
                  onClick={() => setShowSortMenu(!showSortMenu)}
                  className="flex items-center gap-2 px-3.5 py-2 bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.07] rounded-xl text-[12px] text-white/45 hover:text-white/70 transition-all"
                >
                  <ArrowUpDown size={12} />
                  {SORT_OPTIONS.find(s => s.value === sort)?.label || 'מיון'}
                  <ChevronDown size={10} />
                </button>
                {showSortMenu && (
                  <div className="absolute left-0 top-full mt-1 bg-[#13151f] border border-white/[0.08] rounded-xl py-1 min-w-[180px] z-20 shadow-xl">
                    {SORT_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => { setSort(opt.value); setShowSortMenu(false); }}
                        className={`w-full text-right px-3.5 py-2 text-[12px] transition-colors ${
                          sort === opt.value ? 'text-blue-400 bg-blue-500/10' : 'text-white/60 hover:bg-white/[0.05] hover:text-white/85'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Search button */}
              <button
                onClick={handleSearch}
                disabled={keywords.length === 0 || loading}
                className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-[13px] font-semibold rounded-xl transition-all"
              >
                {loading ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
                חפש
              </button>
            </div>
          </div>

          {/* Expanded filters */}
          {showFilters && (
            <div className="mt-4 pt-4 border-t border-white/[0.06] grid grid-cols-3 gap-4">
              <div>
                <label className="block text-[11px] font-medium text-white/40 mb-1.5">מחיר מינימלי ($)</label>
                <input
                  type="number"
                  value={minPrice}
                  onChange={(e) => setMinPrice(e.target.value)}
                  placeholder="0"
                  min="0"
                  className="w-full bg-[#13151f] border border-white/[0.08] rounded-xl px-3 py-2 text-[12px] text-white/75 placeholder-white/20 outline-none focus:border-blue-500/50 transition-all"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-white/40 mb-1.5">מחיר מקסימלי ($)</label>
                <input
                  type="number"
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                  placeholder="ללא הגבלה"
                  min="0"
                  className="w-full bg-[#13151f] border border-white/[0.08] rounded-xl px-3 py-2 text-[12px] text-white/75 placeholder-white/20 outline-none focus:border-blue-500/50 transition-all"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-white/40 mb-1.5">הנחה מינימלית (%)</label>
                <input
                  type="number"
                  value={minDiscount}
                  onChange={(e) => setMinDiscount(e.target.value)}
                  placeholder="0"
                  min="0"
                  max="100"
                  className="w-full bg-[#13151f] border border-white/[0.08] rounded-xl px-3 py-2 text-[12px] text-white/75 placeholder-white/20 outline-none focus:border-blue-500/50 transition-all"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Results toolbar ───────────────────────────────────────────────── */}
      {searched && (
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {loading ? (
              <span className="text-[13px] text-white/35">טוען...</span>
            ) : (
              <span className="text-[13px] text-white/50">
                נמצאו <strong className="text-white/80">{total}</strong> מוצרים
              </span>
            )}
            {activeTab === 'hot' && (
              <button
                onClick={() => loadHot(1)}
                disabled={loading}
                className="flex items-center gap-1.5 text-[11px] text-white/30 hover:text-white/55 transition-colors"
              >
                <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
                רענן
              </button>
            )}
          </div>

          {/* View toggle */}
          <div className="flex items-center gap-1 bg-[#0e1016] border border-white/[0.06] rounded-lg p-0.5">
            <button
              onClick={() => setView('grid')}
              className={`p-1.5 rounded-md transition-all ${view === 'grid' ? 'bg-white/[0.08] text-white/80' : 'text-white/30 hover:text-white/55'}`}
            >
              <LayoutGrid size={14} />
            </button>
            <button
              onClick={() => setView('list')}
              className={`p-1.5 rounded-md transition-all ${view === 'list' ? 'bg-white/[0.08] text-white/80' : 'text-white/30 hover:text-white/55'}`}
            >
              <List size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ── Content ───────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-24">
          <Loader2 size={28} className="animate-spin text-blue-400 mb-4" />
          <p className="text-[13px] text-white/35">מחפש מוצרים...</p>
        </div>
      ) : !searched ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-2xl bg-blue-500/[0.08] border border-blue-500/[0.15] flex items-center justify-center mb-5">
            <Search size={24} className="text-blue-400" />
          </div>
          <p className="text-[15px] font-medium text-white/50 mb-1">הזן מילות מפתח וחפש מוצרים</p>
          <p className="text-[13px] text-white/25">למשל: tactical gear, smart watch, wireless earbuds</p>
        </div>
      ) : products.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Package size={36} className="text-white/15 mb-4" />
          <p className="text-[14px] font-medium text-white/40 mb-1">לא נמצאו מוצרים</p>
          <p className="text-[12px] text-white/25">נסה מילות מפתח שונות או הרחב את הסינון</p>
        </div>
      ) : view === 'grid' ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {products.map((p) => (
              <ProductCard key={p.product_id} product={p} view="grid" />
            ))}
          </div>
        </>
      ) : (
        <div className="bg-[#0e1016] border border-white/[0.06] rounded-2xl overflow-hidden">
          {/* List header */}
          <div className="flex items-center gap-4 px-5 py-2.5 border-b border-white/[0.05] bg-white/[0.02]">
            <div className="w-14 shrink-0" />
            <p className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-white/25">מוצר</p>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-white/25 w-24 text-right">מחיר</p>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-white/25 w-24 text-right">עמלה</p>
            <div className="w-28" />
          </div>
          {products.map((p) => (
            <ProductCard key={p.product_id} product={p} view="list" />
          ))}
        </div>
      )}

      {/* ── Pagination ────────────────────────────────────────────────────── */}
      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-8">
          <button
            onClick={() => activeTab === 'hot' ? loadHot(page - 1) : loadSearch(page - 1)}
            disabled={page === 1}
            className="px-4 py-2 rounded-xl text-[12px] text-white/40 hover:text-white/70 hover:bg-white/[0.05] disabled:opacity-30 disabled:cursor-not-allowed transition-all border border-white/[0.06]"
          >
            הקודם
          </button>
          {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
            const n = page <= 4 ? i + 1 : page - 3 + i;
            if (n < 1 || n > totalPages) return null;
            return (
              <button
                key={n}
                onClick={() => activeTab === 'hot' ? loadHot(n) : loadSearch(n)}
                className={`w-9 h-9 rounded-xl text-[12px] font-medium transition-all ${
                  n === page
                    ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/40'
                    : 'text-white/40 hover:text-white/70 hover:bg-white/[0.05] border border-white/[0.06]'
                }`}
              >
                {n}
              </button>
            );
          })}
          <button
            onClick={() => activeTab === 'hot' ? loadHot(page + 1) : loadSearch(page + 1)}
            disabled={page >= totalPages}
            className="px-4 py-2 rounded-xl text-[12px] text-white/40 hover:text-white/70 hover:bg-white/[0.05] disabled:opacity-30 disabled:cursor-not-allowed transition-all border border-white/[0.06]"
          >
            הבא
          </button>
        </div>
      )}
    </div>
  );
}
