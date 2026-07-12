'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Store, Plus, Loader2, Trash2, Link2, Sparkles, X,
  Package, CheckCircle2, AlertTriangle, Search, Pencil, Grid3x3, Images, Wand2,
  Globe, FileText, ListOrdered, Clock, CheckCheck, AlertCircle, ShoppingBag, Layers,
  Maximize2, ChevronLeft, ChevronRight, Check,
} from 'lucide-react';
import { suppliersApi, channelsApi, credentialsApi, templatesApi, yupooImg } from '@/lib/api-client';
import { PostPreview } from '@/components/products/PostPreview';
import { TemplatePanel, BUILTIN as BUILTIN_BODY_TEMPLATES } from '@/components/templates/TemplatePanel';
import type { SupplierCatalog, SupplierProduct, SkuMatchMode, Channel, PostPreview as PostPreviewType, PostTemplate } from '@/types';

const POST_LANGS: { value: string; label: string }[] = [
  { value: 'he', label: 'עברית' },
  { value: 'ar', label: 'العربية' },
  { value: 'en', label: 'English' },
];
const BUILTIN_DEFAULT_TEMPLATE: PostTemplate = { id: 'builtin_default', name: 'ברירת מחדל', icon: '✨', content: '', builtin: true };

const SYMS: Record<string, string> = { ILS: '₪', EUR: '€', GBP: '£', USD: '$' };
const priceSym = (c: string) => SYMS[c] || '$';
const fmtDate = (d?: string) => d ? new Date(d).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';

const MATCH_MODES: { value: SkuMatchMode; label: string; hint: string }[] = [
  { value: 'numeric', label: 'מספרי', hint: 'משווה רק את המספר (LUN1526 = LN1526)' },
  { value: 'exact', label: 'מדויק', hint: 'התאמה מלאה כולל אותיות (ABC123 = ABC123)' },
  { value: 'prefix_map', label: 'מיפוי קידומת', hint: 'מסיר קידומת מוגדרת ואז משווה' },
  { value: 'regex', label: 'ביטוי רגולרי', hint: 'חילוץ קוד לפי תבנית מותאמת' },
];

export default function SuppliersPage() {
  const [tab, setTab] = useState<'catalogs' | 'products'>('catalogs');
  const [catalogs, setCatalogs] = useState<SupplierCatalog[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);

  const loadCatalogs = useCallback(async () => {
    const [cats, chs] = await Promise.all([
      suppliersApi.listCatalogs().catch(() => []),
      channelsApi.list().catch(() => []),
    ]);
    setCatalogs(cats);
    setChannels(chs);
    setLoading(false);
  }, []);

  useEffect(() => { loadCatalogs(); }, [loadCatalogs]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Store size={22} className="text-blue-400" /> ספקים
        </h1>
        <p className="text-sm text-white/40 mt-1">
          חבר מוצרי Yupoo (תוכן אמיתי) לקישורי השותפים של FLYLINK — מבודד לחלוטין מ-AliExpress
        </p>
      </div>

      <div className="flex bg-surface-secondary border border-edge-hover rounded-xl p-1 gap-1 mb-6 w-fit">
        {(['catalogs', 'products'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${tab === t ? 'bg-blue-600/20 text-blue-400' : 'text-white/40 hover:text-white/70'}`}>
            {t === 'catalogs' ? 'קטלוגים' : 'מוצרים'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 size={24} className="animate-spin text-blue-400" /></div>
      ) : tab === 'catalogs' ? (
        <CatalogsTab catalogs={catalogs} channels={channels} reload={loadCatalogs} />
      ) : (
        <ProductsTab catalogs={catalogs} channels={channels} />
      )}
    </div>
  );
}

// ─── Catalogs tab ─────────────────────────────────────────────────────────────
function CatalogsTab({ catalogs, channels, reload }: { catalogs: SupplierCatalog[]; channels: Channel[]; reload: () => void }) {
  const [editing, setEditing] = useState<SupplierCatalog | 'new' | null>(null);

  return (
    <div>
      <button onClick={() => setEditing('new')}
        className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-xl transition-all mb-5">
        <Plus size={15} /> הוסף קטלוג ספק
      </button>

      {catalogs.length === 0 ? (
        <div className="bg-surface-secondary border border-dashed border-edge-hover rounded-2xl p-14 text-center">
          <Store size={32} className="text-white/15 mx-auto mb-3" />
          <p className="text-sm text-white/40">אין קטלוגים עדיין — הוסף קטלוג ספק ראשון</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {catalogs.map((c) => (
            <div key={c.id} className="bg-surface-secondary border border-edge rounded-xl p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">{c.name}</p>
                  <p className="text-xs text-white/40 mt-0.5" dir="ltr">{c.source_store}.x.yupoo.com</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setEditing(c)} className="p-1.5 text-white/40 hover:text-white/80 hover:bg-white/5 rounded-lg"><Pencil size={13} /></button>
                  <button onClick={async () => { if (confirm('למחוק קטלוג זה?')) { await suppliersApi.deleteCatalog(c.id); reload(); } }}
                    className="p-1.5 text-red-400/60 hover:text-red-400 hover:bg-red-500/10 rounded-lg"><Trash2 size={13} /></button>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-3 text-2xs">
                <span className="bg-white/5 border border-edge rounded-full px-2 py-0.5 text-white/50">התאמה: {MATCH_MODES.find((m) => m.value === c.sku_match_mode)?.label}</span>
                <span className="bg-white/5 border border-edge rounded-full px-2 py-0.5 text-white/50">{c.affiliate_network}</span>
                {c.target_channel_id && <span className="bg-blue-500/10 border border-blue-500/20 rounded-full px-2 py-0.5 text-blue-400">קבוצה מקושרת</span>}
                {!c.enabled && <span className="bg-amber-500/10 text-amber-400 rounded-full px-2 py-0.5">מושבת</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <CatalogModal catalog={editing === 'new' ? null : editing} channels={channels}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
      )}
    </div>
  );
}

function CatalogModal({ catalog, channels, onClose, onSaved }: { catalog: SupplierCatalog | null; channels: Channel[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: catalog?.name || '',
    source_store: catalog?.source_store || '',
    affiliate_network: catalog?.affiliate_network || 'flylink',
    sku_match_mode: (catalog?.sku_match_mode || 'numeric') as SkuMatchMode,
    source_prefix: catalog?.sku_match_config?.source_prefix || '',
    affiliate_prefix: catalog?.sku_match_config?.affiliate_prefix || '',
    target_channel_id: catalog?.target_channel_id || '',
    enabled: catalog?.enabled ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<string | null>(null);
  const [error, setError] = useState('');

  const doProbe = async () => {
    if (!form.source_store.trim()) return;
    setProbing(true); setProbe(null);
    try {
      const r = await suppliersApi.probeStore(form.source_store.trim());
      setProbe(`נמצאו ${r.count} מוצרים · קוד לדוגמה: ${r.sample_code} · מומלץ: ${MATCH_MODES.find((m) => m.value === r.suggested_mode)?.label}`);
      if (r.suggested_mode) setForm((f) => ({ ...f, sku_match_mode: r.suggested_mode as SkuMatchMode }));
    } catch (e: any) { setProbe('בדיקת החנות נכשלה — ' + (e?.response?.data?.message || 'שגיאה')); }
    finally { setProbing(false); }
  };

  const save = async () => {
    setSaving(true); setError('');
    const payload: any = {
      name: form.name, source_store: form.source_store.trim(), affiliate_network: form.affiliate_network,
      sku_match_mode: form.sku_match_mode, target_channel_id: form.target_channel_id || null, enabled: form.enabled,
      sku_match_config: form.sku_match_mode === 'prefix_map' ? { source_prefix: form.source_prefix, affiliate_prefix: form.affiliate_prefix } : null,
    };
    try {
      if (catalog) await suppliersApi.updateCatalog(catalog.id, payload);
      else await suppliersApi.createCatalog(payload);
      onSaved();
    } catch (e: any) { setError(e?.response?.data?.message || 'שמירה נכשלה'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-surface-primary border border-edge rounded-2xl p-5 w-full max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">{catalog ? 'עריכת קטלוג' : 'קטלוג ספק חדש'}</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white/70"><X size={16} /></button>
        </div>
        <div className="space-y-3.5">
          <Field label="שם הקטלוג"><Input value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="למשל: נעליים YaMMMMMi" /></Field>
          <Field label="חנות Yupoo (ה-slug)" hint="החלק שלפני .x.yupoo.com — למשל seppuyukeji">
            <div className="flex gap-2">
              <Input value={form.source_store} onChange={(v) => setForm((f) => ({ ...f, source_store: v }))} placeholder="seppuyukeji" dir="ltr" />
              <button onClick={doProbe} disabled={probing || !form.source_store.trim()}
                className="shrink-0 flex items-center gap-1.5 px-3 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-50 text-white/70 text-xs rounded-lg">
                {probing ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} בדוק
              </button>
            </div>
            {probe && <p className="text-2xs text-blue-400/80 mt-1.5">{probe}</p>}
          </Field>
          <Field label="כלל התאמת קוד">
            <div className="grid grid-cols-2 gap-2">
              {MATCH_MODES.map((m) => (
                <button key={m.value} onClick={() => setForm((f) => ({ ...f, sku_match_mode: m.value }))}
                  className={`text-right px-3 py-2 rounded-lg border text-xs transition-all ${form.sku_match_mode === m.value ? 'bg-blue-600/15 border-blue-500/40 text-blue-300' : 'border-edge-hover text-white/60 hover:bg-white/5'}`}>
                  <span className="font-medium block">{m.label}</span>
                  <span className="text-2xs text-white/30">{m.hint}</span>
                </button>
              ))}
            </div>
          </Field>
          {form.sku_match_mode === 'prefix_map' && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="קידומת Yupoo"><Input value={form.source_prefix} onChange={(v) => setForm((f) => ({ ...f, source_prefix: v }))} placeholder="LUN" dir="ltr" /></Field>
              <Field label="קידומת FLYLINK"><Input value={form.affiliate_prefix} onChange={(v) => setForm((f) => ({ ...f, affiliate_prefix: v }))} placeholder="LN" dir="ltr" /></Field>
            </div>
          )}
          <Field label="קבוצת פרסום ברירת מחדל" hint="לאן יתפרסמו מוצרים מהקטלוג הזה">
            <select value={form.target_channel_id} onChange={(e) => setForm((f) => ({ ...f, target_channel_id: e.target.value }))}
              className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white/80 outline-none focus:border-blue-500/50">
              <option value="">— ערוץ ברירת המחדל —</option>
              {channels.map((ch) => <option key={ch.id} value={ch.channel_id}>{ch.name}</option>)}
            </select>
          </Field>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={save} disabled={saving || !form.name.trim()}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm font-medium rounded-xl">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} שמור
          </button>
          <button onClick={onClose} className="px-5 py-2.5 bg-white/5 hover:bg-white/10 text-white/60 text-sm rounded-xl">ביטול</button>
        </div>
      </div>
    </div>
  );
}

// ─── Products tab ─────────────────────────────────────────────────────────────
function ProductsTab({ catalogs, channels }: { catalogs: SupplierCatalog[]; channels: Channel[] }) {
  const [mode, setMode] = useState<'mine' | 'browse'>('mine');
  const [products, setProducts] = useState<SupplierProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [linkInit, setLinkInit] = useState<{ catalogId?: string; yupooUrl?: string } | null>(null);
  const [composing, setComposing] = useState<SupplierProduct | null>(null);

  const load = useCallback(async () => {
    setProducts(await suppliersApi.listProducts().catch(() => []));
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const catName = (id: string) => catalogs.find((c) => c.id === id)?.name || 'ספק';
  const catChannel = (id: string) => catalogs.find((c) => c.id === id)?.target_channel_id || '';

  return (
    <div>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex bg-surface-secondary border border-edge-hover rounded-xl p-1 gap-1">
          <button onClick={() => setMode('mine')}
            className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${mode === 'mine' ? 'bg-blue-600/20 text-blue-400' : 'text-white/40 hover:text-white/70'}`}>המוצרים שלי</button>
          <button onClick={() => setMode('browse')} disabled={catalogs.length === 0}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all disabled:opacity-40 ${mode === 'browse' ? 'bg-blue-600/20 text-blue-400' : 'text-white/40 hover:text-white/70'}`}>
            <Grid3x3 size={13} /> עיין בקטלוג
          </button>
        </div>
        {mode === 'mine' && (
          <button onClick={() => setLinkInit({})} disabled={catalogs.length === 0}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-all">
            <Link2 size={15} /> חבר מוצר ידני
          </button>
        )}
      </div>
      {catalogs.length === 0 && <p className="text-xs text-amber-400 mb-4">צור קודם קטלוג ספק בטאב &quot;קטלוגים&quot;</p>}

      {mode === 'browse' ? (
        <StoreBrowser catalogs={catalogs} channels={channels} onLinked={() => { setMode('mine'); load(); }} />
      ) : loading ? (
        <div className="flex justify-center py-20"><Loader2 size={24} className="animate-spin text-blue-400" /></div>
      ) : (
        <SupplierDashboard products={products} catalogs={catalogs} catName={catName}
          onCompose={(p) => setComposing(p)} reload={load} onManualLink={() => setLinkInit({})} />
      )}

      {linkInit && <LinkModal catalogs={catalogs} initial={linkInit} onClose={() => setLinkInit(null)} onDone={() => { setLinkInit(null); setMode('mine'); load(); }} />}
      {composing && (
        <SavedProductPostModal product={composing} channels={channels}
          defaultChannel={catChannel(composing.supplier_catalog_id)}
          onClose={() => setComposing(null)} onSent={load} />
      )}
    </div>
  );
}

// ─── In-system Yupoo store browser ────────────────────────────────────────────
function StoreBrowser({ catalogs, channels, onLinked }: { catalogs: SupplierCatalog[]; channels: Channel[]; onLinked: () => void }) {
  const [catalogId, setCatalogId] = useState(catalogs[0]?.id || '');
  const [opened, setOpened] = useState<string | null>(null); // album_url of the product modal
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [category, setCategory] = useState('');
  const [items, setItems] = useState<Array<{ code: string; price: number; description: string; album_url: string; thumb?: string }>>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (p: number, cat: string, withCats: boolean) => {
    if (!catalogId) return;
    setLoading(true); setError('');
    try {
      const r = await suppliersApi.browse(catalogId, { page: p, category: cat || undefined, with_categories: withCats ? 1 : 0 });
      setItems(r.items); setHasMore(r.hasMore); setPage(p);
      if (r.categories) setCategories(r.categories);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'טעינת הקטלוג נכשלה — ייתכן חסימת Yupoo מהשרת');
      setItems([]);
    } finally { setLoading(false); }
  }, [catalogId]);

  useEffect(() => { if (catalogId) { setCategory(''); load(1, '', true); } }, [catalogId, load]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <select value={catalogId} onChange={(e) => setCatalogId(e.target.value)}
          className="bg-surface-secondary border border-edge-hover rounded-xl px-4 py-2 text-sm text-white/70 outline-none focus:border-blue-500/50">
          {catalogs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {categories.length > 0 && (
          <select value={category} onChange={(e) => { setCategory(e.target.value); load(1, e.target.value, false); }}
            className="bg-surface-secondary border border-edge-hover rounded-xl px-4 py-2 text-sm text-white/70 outline-none focus:border-blue-500/50 max-w-[220px]">
            <option value="">כל הקטגוריות ({categories.length})</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/25 text-red-300 text-sm rounded-xl px-4 py-3 mb-4">{error}</div>}

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 size={24} className="animate-spin text-blue-400" /></div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {items.map((it) => (
              <button key={it.album_url} onClick={() => setOpened(it.album_url)}
                className="text-right bg-surface-secondary border border-edge rounded-xl overflow-hidden hover:border-blue-500/40 hover:-translate-y-0.5 transition-all group">
                <div className="relative aspect-square bg-white/[0.04]">
                  {it.thumb
                    /* eslint-disable-next-line @next/next/no-img-element */
                    ? <img src={yupooImg(it.thumb)} alt="" className="w-full h-full object-cover" loading="lazy" />
                    : <div className="w-full h-full flex items-center justify-center"><Package size={32} className="text-white/15" /></div>}
                  <span className="absolute bottom-2 left-2 bg-black/60 text-white/90 text-xs rounded-full px-2.5 py-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Images size={12} /> פתח
                  </span>
                </div>
                <div className="p-3">
                  <p className="text-sm text-white/80 truncate min-h-[1.25rem]" dir="ltr" title={it.description}>{it.description || '—'}</p>
                  <p className="text-xs text-white/40 truncate mt-0.5" dir="ltr">#{it.code}</p>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-base font-bold text-white">${it.price}</span>
                    <span className="text-xs text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1"><Wand2 size={12} /> צור פוסט</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
          {items.length === 0 && <p className="text-center text-sm text-white/30 py-12">לא נמצאו מוצרים</p>}
          {(page > 1 || hasMore) && (
            <div className="flex items-center justify-center gap-3 mt-6">
              <button disabled={page <= 1} onClick={() => load(page - 1, category, false)}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-40 text-white/60 text-sm rounded-xl">הקודם</button>
              <span className="text-xs text-white/40">עמוד {page}</span>
              <button disabled={!hasMore} onClick={() => load(page + 1, category, false)}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-40 text-white/60 text-sm rounded-xl">הבא</button>
            </div>
          )}
        </>
      )}

      {opened && (
        <BrowseProductModal
          catalogId={catalogId}
          albumUrl={opened}
          channels={channels}
          defaultChannel={catalogs.find((c) => c.id === catalogId)?.target_channel_id || ''}
          onClose={() => setOpened(null)}
          onLinked={() => { setOpened(null); onLinked(); }}
        />
      )}
    </div>
  );
}

// ─── Post composer — IDENTICAL to the AliExpress quick-post flow ────────────────
// Same TemplatePanel (built-in + user templates), same language selector, same
// PostPreview, same Gemini generation (via the suppliers preview endpoint which
// reuses PostsService.preview → generateText). Wired to the supplier publish endpoints.
function PostComposer({ productId, channels, defaultChannel, onSent }: {
  productId: string; channels: Channel[]; defaultChannel?: string; onSent?: () => void;
}) {
  const [channelId, setChannelId] = useState(defaultChannel || '');
  const [postLang, setPostLang] = useState('he');
  const [template, setTemplate] = useState<PostTemplate>(BUILTIN_DEFAULT_TEMPLATE);
  const [vision, setVision] = useState(true); // let the AI write from the actual product photo
  const [pv, setPv] = useState<(PostPreviewType & { gallery: string[]; vision_used?: boolean }) | null>(null);
  const [selected, setSelected] = useState<string[]>([]); // ordered manual image selection for the album
  const [lightbox, setLightbox] = useState<number | null>(null); // index into gallery for the enlarged viewer
  const [generating, setGenerating] = useState(true);
  const [regen, setRegen] = useState(false);
  const [posting, setPosting] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false); // gate generation until the group's template is resolved
  const galleryInited = useRef(false);

  const chLabel = (ch: string) => ch === 'default' ? 'ברירת מחדל' : 'קבוצה';

  // Collage mode composes many photos into grid "sheets" → up to 30 in one album.
  const [collage, setCollage] = useState(false);
  const [collageCells, setCollageCells] = useState(6); // images per sheet: 4 / 6 / 9
  const maxImages = collage ? 30 : 10;

  // First N images selected by default; the gallery is stable across text regenerations.
  const gallery = pv?.gallery || [];
  useEffect(() => {
    if (!galleryInited.current && gallery.length) {
      galleryInited.current = true;
      setSelected(gallery.slice(0, 10));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gallery.length]);

  // Leaving collage mode → trim any selection above the 10-image album cap.
  useEffect(() => {
    if (!collage) setSelected((prev) => (prev.length > 10 ? prev.slice(0, 10) : prev));
  }, [collage]);

  const toggleImage = (url: string) => {
    setSelected((prev) => {
      if (prev.includes(url)) return prev.filter((u) => u !== url);
      if (prev.length >= maxImages) return prev; // cap: 10 normal, 30 collage
      return [...prev, url];
    });
  };
  const selectedImages = () => (selected.length ? selected : undefined);
  const cells = () => (collage ? collageCells : undefined);

  // Resolve the body template for a group: the group's OWN template if assigned
  // (Templates ← שיוך לקבוצות), else the user's global default, else built-in default.
  const [customTemplates, setCustomTemplates] = useState<PostTemplate[]>([]);
  const [globalBodyId, setGlobalBodyId] = useState('builtin_default');
  const resolveTemplateFor = useCallback((chId: string, custom: PostTemplate[], globalId: string): PostTemplate => {
    const ch = channels.find((c) => c.channel_id === chId);
    const wantId = ch?.body_template_id || globalId || 'builtin_default';
    const all = [...BUILTIN_BODY_TEMPLATES, ...custom.map((t) => ({ ...t, builtin: false }))];
    return all.find((t) => t.id === wantId) || BUILTIN_DEFAULT_TEMPLATE;
  }, [channels]);

  useEffect(() => {
    Promise.all([credentialsApi.get(), templatesApi.list()])
      .then(([c, ts]) => {
        const gid = c.default_body_template_id || 'builtin_default';
        setCustomTemplates(ts);
        setGlobalBodyId(gid);
        setTemplate(resolveTemplateFor(channelId, ts, gid));
      })
      .catch(() => {})
      .finally(() => setReady(true)); // now allow the first generation (once)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the target group changes, switch to THAT group's body template.
  useEffect(() => {
    if (!ready) return;
    setTemplate(resolveTemplateFor(channelId, customTemplates, globalBodyId));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  const fetchPreview = useCallback(
    () => suppliersApi.preview(productId, { language: postLang, template: template.content || undefined, vision }),
    [productId, postLang, template, vision],
  );

  // Generate once the group's template is resolved, and on every language/template
  // change after (mirrors quick-post). Gated on `ready` so mount generates exactly once.
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    setGenerating(true); setErr(null);
    fetchPreview()
      .then((r) => { if (alive) setPv(r); })
      .catch((e: any) => { if (alive) setErr(e?.response?.data?.message || 'יצירת הפוסט נכשלה — נסה שוב'); })
      .finally(() => { if (alive) setGenerating(false); });
    return () => { alive = false; };
  }, [fetchPreview, ready]);

  const onPost = async (text: string) => {
    setPosting(true); setDone(null); setErr(null);
    try { const r = await suppliersApi.send(productId, channelId || undefined, text, selectedImages(), cells()); setDone(`✓ נשלח (${chLabel(r.channel)})`); onSent?.(); }
    catch (e: any) { setErr(e?.response?.data?.message || 'השליחה נכשלה — נסה שוב'); }
    finally { setPosting(false); }
  };
  const onSchedule = async (text: string, at: string) => {
    try { const r = await suppliersApi.schedule(productId, at, channelId || undefined, text, selectedImages(), cells()); setDone(`✓ תוזמן (${chLabel(r.channel)})`); onSent?.(); }
    catch (e: any) { setErr(e?.response?.data?.message || 'התזמון נכשל — נסה שוב'); throw e; }
  };
  const onQueue = async (text: string) => {
    const r = await suppliersApi.queue(productId, channelId || undefined, text, selectedImages(), cells());
    onSent?.();
    return { queue_active: r.queue_active, interval_minutes: r.interval_minutes };
  };
  const onRegenerate = async () => {
    setRegen(true); setErr(null);
    try { setPv(await fetchPreview()); }
    catch (e: any) { setErr(e?.response?.data?.message || 'יצירת הפוסט נכשלה'); }
    finally { setRegen(false); }
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4 items-start">
      {/* Left: gallery + channel + template panel */}
      <div className="w-full lg:w-64 shrink-0 space-y-3">
        {gallery.length > 1 && (
          <div className="bg-surface-secondary border border-edge rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-2xs text-white/40 flex items-center gap-1"><Images size={11} /> בחר תמונות</p>
              <span className={`text-2xs ${selected.length >= maxImages ? 'text-amber-400' : 'text-white/40'}`}>{selected.length}/{maxImages}</span>
            </div>

            {/* Collage mode — compose many photos into grid sheets so up to 30 fit in one album */}
            <div className="mb-2 rounded-lg border border-edge-hover bg-white/[0.02] p-2">
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-2xs text-white/60 flex items-center gap-1"><Grid3x3 size={11} /> קולאז&apos; (עד 30 תמונות בפוסט אחד)</span>
                <input type="checkbox" checked={collage} onChange={(e) => setCollage(e.target.checked)} className="accent-blue-600" />
              </label>
              {collage && (
                <div className="mt-2">
                  <div className="flex items-center gap-1">
                    <span className="text-2xs text-white/40 ml-1">פריסה:</span>
                    {[{ v: 4, l: '2×2' }, { v: 6, l: '2×3' }, { v: 9, l: '3×3' }].map((o) => (
                      <button key={o.v} onClick={() => setCollageCells(o.v)}
                        className={`px-2 py-0.5 rounded-md text-2xs font-medium transition-all ${collageCells === o.v ? 'bg-blue-600/20 text-blue-300 border border-blue-500/40' : 'text-white/40 border border-transparent hover:bg-white/5'}`}>
                        {o.l}
                      </button>
                    ))}
                  </div>
                  <p className="text-2xs text-white/25 mt-1.5">
                    {selected.length} תמונות → {Math.max(1, Math.ceil(selected.length / collageCells))} גיליונות באלבום אחד
                  </p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2 max-h-72 overflow-y-auto pr-0.5">
              {gallery.map((g, i) => {
                const idx = selected.indexOf(g);
                const on = idx !== -1;
                const atMax = selected.length >= maxImages;
                return (
                  <div key={i}
                    className={`group/th relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${on ? 'border-blue-500' : 'border-transparent'}`}>
                    {/* Click the image to open it large (some photos carry the product code) */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={g} alt="" onClick={() => setLightbox(i)}
                      className="w-full h-full object-cover cursor-zoom-in" loading="lazy" />
                    {!on && <span className="absolute inset-0 bg-black/30 pointer-events-none" />}
                    {/* Quick select/deselect toggle */}
                    <button type="button" onClick={() => toggleImage(g)} disabled={!on && atMax}
                      title={on ? 'הסר מהאלבום' : 'הוסף לאלבום'}
                      className={`absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${on ? 'bg-blue-600 text-white' : 'bg-black/60 text-white/70 hover:bg-black/80'}`}>
                      {on ? idx + 1 : <Check size={11} />}
                    </button>
                    {/* Enlarge affordance */}
                    <button type="button" onClick={() => setLightbox(i)} title="הגדל"
                      className="absolute bottom-1 left-1 w-5 h-5 rounded-full bg-black/60 text-white/80 flex items-center justify-center opacity-0 group-hover/th:opacity-100 transition-opacity">
                      <Maximize2 size={11} />
                    </button>
                  </div>
                );
              })}
            </div>
            <p className="text-2xs text-white/25 mt-1.5">לחץ תמונה להגדלה · הסדר = סדר הבחירה{collage ? ' · קולאז\' עד 30' : ' · אלבום עד 10'}.</p>
          </div>
        )}
        <div className="bg-surface-secondary border border-edge rounded-xl p-3">
          <Field label="קבוצת פרסום" hint="ברירת המחדל = הקבוצה שקושרה לקטלוג">
            <select value={channelId} onChange={(e) => setChannelId(e.target.value)}
              className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white/80 outline-none focus:border-blue-500/50">
              <option value="">— ברירת מחדל של הקטלוג / כללי —</option>
              {channels.map((ch) => <option key={ch.id} value={ch.channel_id}>{ch.name}</option>)}
            </select>
          </Field>
        </div>
        <TemplatePanel selectedId={template.id} onSelect={setTemplate} />
      </div>

      {/* Right: language selector + Telegram preview */}
      <div className="flex-1 min-w-0 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Globe size={13} className="text-white/30" />
            <span className="text-xs text-white/40">שפת פוסט:</span>
            <div className="flex bg-surface-secondary border border-edge-hover rounded-xl p-1 gap-0.5">
              {POST_LANGS.map(({ value, label }) => (
                <button key={value} onClick={() => setPostLang(value)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${postLang === value ? 'bg-white/10 text-white' : 'text-white/30 hover:text-white/60'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <button onClick={() => setVision((v) => !v)}
            title="הבינה תכתוב לפי מה שהיא מזהה בתמונת המוצר (מומלץ כשאין תיאור בקטלוג)"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium transition-all ${vision ? 'bg-violet-600/20 border-violet-500/40 text-violet-300' : 'bg-white/5 border-edge-hover text-white/40 hover:text-white/70'}`}>
            <Images size={12} /> כתוב לפי התמונה {vision ? '✓' : ''}
          </button>
        </div>

        {done && <div className="bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-sm rounded-xl px-4 py-2.5">{done}</div>}
        {err && <div className="bg-red-500/10 border border-red-500/25 text-red-300 text-sm rounded-xl px-4 py-3">{err}</div>}
        {vision && pv && pv.vision_used === false && !generating && (
          <div className="text-2xs text-amber-400/80">לא ניתן היה לטעון את תמונת המוצר — הטקסט נכתב ללא ניתוח תמונה.</div>
        )}

        {generating ? (
          <div className="bg-surface-secondary border border-edge rounded-xl p-10 flex justify-center"><Loader2 size={20} className="animate-spin text-blue-400" /></div>
        ) : pv ? (
          <PostPreview preview={pv} onPost={onPost} onSchedule={onSchedule} onQueue={onQueue}
            onRegenerate={onRegenerate} isPosting={posting} isRegenerating={regen} />
        ) : null}
      </div>

      {lightbox !== null && gallery[lightbox] && (
        <ImageLightbox
          images={gallery}
          index={lightbox}
          selected={selected}
          maxAlbum={maxImages}
          onIndex={setLightbox}
          onToggle={toggleImage}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

// ─── Enlarged image viewer with select/deselect + navigation ───────────────────
function ImageLightbox({ images, index, selected, maxAlbum, onIndex, onToggle, onClose }: {
  images: string[]; index: number; selected: string[]; maxAlbum: number;
  onIndex: (i: number) => void; onToggle: (url: string) => void; onClose: () => void;
}) {
  const url = images[index];
  const order = selected.indexOf(url);
  const on = order !== -1;
  const atMax = selected.length >= maxAlbum;
  const prev = () => onIndex((index - 1 + images.length) % images.length);
  const next = () => onIndex((index + 1) % images.length);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') onIndex((index + 1) % images.length);      // RTL: left = next
      else if (e.key === 'ArrowRight') onIndex((index - 1 + images.length) % images.length);
      else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (on || !atMax) onToggle(url); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, images.length, on, atMax, url, onIndex, onToggle, onClose]);

  return (
    <div className="fixed inset-0 z-[60] bg-black/90 flex flex-col items-center justify-center p-4" onClick={onClose} dir="rtl">
      <button onClick={onClose} className="absolute top-4 left-4 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"><X size={18} /></button>
      <span className="absolute top-5 right-5 text-white/60 text-sm">{index + 1} / {images.length}</span>

      {/* prev (right, RTL) */}
      <button onClick={(e) => { e.stopPropagation(); prev(); }}
        className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"><ChevronRight size={22} /></button>
      {/* next (left, RTL) */}
      <button onClick={(e) => { e.stopPropagation(); next(); }}
        className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"><ChevronLeft size={22} /></button>

      <div className="flex flex-col items-center gap-4" onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" className="max-h-[74vh] max-w-[86vw] object-contain rounded-lg" />
        <button onClick={() => onToggle(url)} disabled={!on && atMax}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed ${on ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-white/10 hover:bg-white/20 text-white'}`}>
          {on ? <><Check size={15} /> נבחרה (#{order + 1}) — הסר</> : atMax ? `הגעת ל-${maxAlbum} תמונות` : <><Plus size={15} /> הוסף לאלבום</>}
        </button>
      </div>
    </div>
  );
}

// ─── Browse → open product (all images) → create post ──────────────────────────
function BrowseProductModal({ catalogId, albumUrl, channels, defaultChannel, onClose, onLinked }: {
  catalogId: string; albumUrl: string; channels: Channel[]; defaultChannel?: string;
  onClose: () => void; onLinked: () => void;
}) {
  const [album, setAlbum] = useState<Awaited<ReturnType<typeof suppliersApi.previewAlbum>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [flylinkUrl, setFlylinkUrl] = useState('');
  const [code, setCode] = useState('');
  const [linking, setLinking] = useState(false);
  const [productId, setProductId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true); setError('');
      try { setAlbum(await suppliersApi.previewAlbum(catalogId, albumUrl)); }
      catch (e: any) { setError(e?.response?.data?.message || 'טעינת המוצר נכשלה'); }
      finally { setLoading(false); }
    })();
  }, [catalogId, albumUrl]);

  const startPost = async () => {
    setLinking(true); setError('');
    try {
      const linked = await suppliersApi.link({ catalogId, yupooUrl: albumUrl, flylinkUrl, code: code || undefined });
      setProductId(linked.id); // composer self-generates the post text
      onLinked(); // refresh "My Products" in the background — modal stays open on the composer
    } catch (e: any) { setError(e?.response?.data?.message || 'החיבור נכשל'); }
    finally { setLinking(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className={`relative bg-surface-primary border border-edge rounded-2xl p-5 w-full max-h-[92vh] overflow-y-auto ${productId ? 'max-w-4xl' : 'max-w-2xl'}`} dir="rtl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Images size={15} className="text-blue-400" /> {productId ? 'יצירת פוסט' : 'מוצר מהקטלוג'}
          </h3>
          <button onClick={onClose} className="text-white/40 hover:text-white/70"><X size={16} /></button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-blue-400" /></div>
        ) : error && !album ? (
          <div className="bg-red-500/10 border border-red-500/25 text-red-300 text-sm rounded-xl px-4 py-3">{error}</div>
        ) : productId ? (
          <PostComposer productId={productId} channels={channels} defaultChannel={defaultChannel} onSent={onLinked} />
        ) : album ? (
          <div className="space-y-4">
            {/* All product images */}
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {album.images.map((img, i) => (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img key={i} src={img} alt="" className="w-full aspect-square object-cover rounded-lg border border-edge" loading="lazy" />
              ))}
            </div>
            <div className="flex items-center justify-between text-sm">
              <div>
                <p className="text-white/85" dir="ltr">{album.description || album.title}</p>
                <p className="text-2xs text-white/40 mt-0.5" dir="ltr">#{album.code} · {album.images.length} תמונות</p>
              </div>
              <span className="text-lg font-bold text-white">{album.currency === 'USD' ? '$' : ''}{album.price}</span>
            </div>

            {/* FLYLINK link — required to publish (each product has its own generated link) */}
            <div className="border-t border-edge pt-4 space-y-3">
              <Field label="קישור שותפים FLYLINK" hint="הקישור הייחודי שיצרת למוצר הזה ב-FLYLINK — נדרש כדי לפרסם">
                <Input value={flylinkUrl} onChange={setFlylinkUrl} placeholder="https://…flylinking.com/…" dir="ltr" />
              </Field>
              <Field label="קוד מוצר FLYLINK (אופציונלי)" hint="לאימות מול Yupoo — קישור השותפים אטום ולרוב לא מכיל קוד">
                <Input value={code} onChange={setCode} placeholder={album.code} dir="ltr" />
              </Field>
              {error && <div className="flex items-center gap-2 text-xs text-red-400"><AlertTriangle size={13} /> {error}</div>}
              <button onClick={startPost} disabled={linking || !flylinkUrl.trim()}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-all">
                {linking ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} צור פוסט
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── My-products: full post composer for an already-linked product ─────────────
function SavedProductPostModal({ product, channels, defaultChannel, onClose, onSent }: {
  product: SupplierProduct; channels: Channel[]; defaultChannel?: string; onClose: () => void; onSent: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-surface-primary border border-edge rounded-2xl p-5 w-full max-w-4xl max-h-[92vh] overflow-y-auto" dir="rtl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2 truncate">
            <Wand2 size={15} className="text-blue-400 shrink-0" /> <span className="truncate">יצירת פוסט — {product.title}</span>
          </h3>
          <button onClick={onClose} className="text-white/40 hover:text-white/70 shrink-0"><X size={16} /></button>
        </div>
        <PostComposer productId={product.id} channels={channels} defaultChannel={defaultChannel} onSent={onSent} />
      </div>
    </div>
  );
}

// ─── FLYLINK products dashboard — mirrors the AliExpress /products table ─────────
function SupplierDashboard({ products, catalogs, catName, onCompose, reload, onManualLink }: {
  products: SupplierProduct[]; catalogs: SupplierCatalog[]; catName: (id: string) => string;
  onCompose: (p: SupplierProduct) => void; reload: () => void; onManualLink: () => void;
}) {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [catalogFilter, setCatalogFilter] = useState('all');
  const [stockFilter, setStockFilter] = useState<'all' | 'in' | 'out'>('all');
  const [postFilter, setPostFilter] = useState<'all' | 'has' | 'none'>('all');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<SupplierProduct | null>(null);
  const LIMIT = 20;
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();

  const stats = {
    total: products.length,
    inStock: products.filter((p) => p.in_stock !== false).length,
    hasPost: products.filter((p) => p.has_post).length,
    catalogs: new Set(products.map((p) => p.supplier_catalog_id)).size,
  };

  const filtered = products.filter((p) => {
    if (catalogFilter !== 'all' && p.supplier_catalog_id !== catalogFilter) return false;
    if (stockFilter === 'in' && p.in_stock === false) return false;
    if (stockFilter === 'out' && p.in_stock !== false) return false;
    if (postFilter === 'has' && !p.has_post) return false;
    if (postFilter === 'none' && p.has_post) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (!((p.title || '').toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q))) return false;
    }
    return true;
  });
  const total = filtered.length;
  const totalPages = Math.ceil(total / LIMIT);
  const pageItems = filtered.slice((page - 1) * LIMIT, page * LIMIT);

  useEffect(() => { setPage(1); }, [search, catalogFilter, stockFilter, postFilter]);

  const handleSearchChange = (val: string) => {
    setSearchInput(val);
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => setSearch(val), 300);
  };

  const STOCK_TABS: { key: 'all' | 'in' | 'out'; label: string; count: number; color?: string }[] = [
    { key: 'all', label: 'הכל', count: stats.total },
    { key: 'in', label: 'במלאי', count: stats.inStock, color: 'emerald' },
    { key: 'out', label: 'אזל', count: stats.total - stats.inStock, color: 'red' },
  ];

  return (
    <div>
      {/* Stats bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'סה"כ מוצרים', value: stats.total, sub: `${stats.inStock} במלאי`, icon: Package },
          { label: 'זמינים', value: stats.inStock, sub: stats.total ? `${Math.round((stats.inStock / stats.total) * 100)}% מהכלל` : '', icon: CheckCircle2 },
          { label: 'עם פוסט', value: stats.hasPost, sub: 'פורסמו/בתור', icon: FileText },
          { label: 'קטלוגים', value: stats.catalogs, sub: 'FLYLINK', icon: Layers },
        ].map((card) => (
          <div key={card.label} className="bg-surface-secondary border border-edge rounded-xl px-4 py-3.5">
            <div className="flex items-center gap-2 mb-2">
              <card.icon size={13} className="text-white/25" />
              <span className="text-xs text-white/35">{card.label}</span>
            </div>
            <p className="text-[22px] font-bold text-white leading-none">{card.value}</p>
            {card.sub && <p className="text-xs text-white/30 mt-1">{card.sub}</p>}
          </div>
        ))}
      </div>

      {/* Filters + table */}
      <div className="bg-surface-secondary border border-edge rounded-xl">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-edge flex-wrap">
          <div className="relative w-64">
            <Search size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/25" />
            <input value={searchInput} onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="חפש לפי כותרת או קוד..."
              className="w-full bg-surface-tertiary border border-edge rounded-xl pr-8 pl-3.5 py-2 text-xs text-white/70 placeholder-white/20 outline-none focus:border-blue-500/40" />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <select value={catalogFilter} onChange={(e) => setCatalogFilter(e.target.value)}
              className="bg-surface-tertiary border border-edge rounded-lg px-2.5 py-1.5 text-xs text-white/60 outline-none focus:border-blue-500/40 max-w-[160px]">
              <option value="all">כל הקטלוגים</option>
              {catalogs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {STOCK_TABS.map((tab) => {
              const colorMap: Record<string, string> = { emerald: 'bg-emerald-500 text-white', red: 'bg-red-500 text-white' };
              const active = stockFilter === tab.key;
              return (
                <button key={tab.key} onClick={() => setStockFilter(tab.key)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${active ? (tab.color ? colorMap[tab.color] : 'bg-[var(--bg-tertiary)] text-[var(--text)] border border-[var(--border-hover)]') : 'text-white/40 hover:text-white/70 hover:bg-white/[0.05]'}`}>
                  {tab.label}<span className={`text-2xs ${active ? 'opacity-80' : 'opacity-50'}`}>{tab.count}</span>
                </button>
              );
            })}
            <div className="flex items-center gap-1 mr-1 border-r border-edge pr-2">
              {(['all', 'has', 'none'] as const).map((f) => (
                <button key={f} onClick={() => setPostFilter(f)}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-all ${postFilter === f ? 'bg-[var(--bg-tertiary)] text-[var(--text)] border border-[var(--border)]' : 'text-white/30 hover:text-white/55 border border-transparent'}`}>
                  <FileText size={10} />{f === 'all' ? 'הכל' : f === 'has' ? 'יש פוסט' : 'אין פוסט'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {pageItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-edge flex items-center justify-center mb-4">
              <ShoppingBag size={22} className="text-white/20" />
            </div>
            <p className="text-sm font-medium text-white/50">{products.length === 0 ? 'אין מוצרים מחוברים' : 'אין מוצרים תואמים לסינון'}</p>
            <p className="text-xs text-white/25 mt-1 mb-4">חבר מוצרים מ&quot;עיין בקטלוג&quot; או ידנית</p>
            {products.length === 0 && (
              <button onClick={onManualLink} disabled={catalogs.length === 0}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-body font-semibold rounded-xl transition-all">
                <Link2 size={13} /> חבר מוצר ידני
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-edge">
                  {['מוצר', 'מחיר', 'קטלוג', 'מלאי', 'סונכרן', 'פעולות'].map((col) => (
                    <th key={col} className="px-4 py-2.5 text-2xs font-semibold uppercase tracking-wider text-white/25 text-right">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageItems.map((p) => (
                  <SupplierRow key={p.id} product={p} catalogName={catName(p.supplier_catalog_id)}
                    onCompose={() => onCompose(p)} onEdit={() => setEditing(p)} reload={reload} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-edge">
            <p className="text-xs text-white/30">מציג {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} מתוך {total}</p>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 rounded-lg text-xs text-white/40 hover:text-white/70 hover:bg-white/[0.05] disabled:opacity-30 transition-all">הקודם</button>
              <span className="text-xs text-white/40 px-2">עמוד {page}/{totalPages}</span>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="px-3 py-1.5 rounded-lg text-xs text-white/40 hover:text-white/70 hover:bg-white/[0.05] disabled:opacity-30 transition-all">הבא</button>
            </div>
          </div>
        )}
      </div>

      {editing && <SupplierEditModal product={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

function ActionBtn({ icon: Icon, label, onClick, color = 'default', loading = false, disabled = false }: {
  icon: any; label: string; onClick: () => void; color?: 'default' | 'red' | 'green' | 'purple' | 'blue'; loading?: boolean; disabled?: boolean;
}) {
  const colors: Record<string, string> = {
    default: 'text-white/35 hover:text-white/75 hover:bg-white/[0.07]',
    red: 'text-red-400/60 hover:text-red-400 hover:bg-red-500/10',
    green: 'text-emerald-400/60 hover:text-emerald-400 hover:bg-emerald-500/10',
    purple: 'text-violet-400/60 hover:text-violet-400 hover:bg-violet-500/10',
    blue: 'text-blue-400/60 hover:text-blue-400 hover:bg-blue-500/10',
  };
  return (
    <button title={label} onClick={onClick} disabled={disabled || loading}
      className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all disabled:opacity-40 disabled:cursor-not-allowed ${colors[color]}`}>
      {loading ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />}
    </button>
  );
}

function SupplierRow({ product, catalogName, onCompose, onEdit, reload }: {
  product: SupplierProduct; catalogName: string; onCompose: () => void; onEdit: () => void; reload: () => void;
}) {
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [loadingDesc, setLoadingDesc] = useState(false);
  const [queued, setQueued] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [scheduling, setScheduling] = useState(false);
  const minDateTime = new Date(Date.now() + 2 * 60 * 1000).toISOString().slice(0, 16);
  const s = priceSym(product.currency);

  const handleDelete = async () => {
    if (!confirm(`למחוק את "${(product.title || '').slice(0, 40)}"?`)) return;
    await suppliersApi.deleteProduct(product.id); reload();
  };
  const handleCopy = async () => {
    if (!product.flylink_url) { alert('אין קישור FLYLINK למוצר'); return; }
    await navigator.clipboard.writeText(product.flylink_url);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };
  const handleQueue = async () => {
    setLoadingQueue(true);
    try { await suppliersApi.queue(product.id); setQueued(true); setTimeout(() => setQueued(false), 3000); reload(); }
    catch (e: any) { alert(e?.response?.data?.message || 'שגיאה בהוספה לתור'); }
    finally { setLoadingQueue(false); }
  };
  const handleDesc = async () => {
    setLoadingDesc(true);
    try { await suppliersApi.generateDescription(product.id); reload(); }
    catch (e: any) { alert(e?.response?.data?.message || 'שגיאה ביצירת תיאור'); }
    finally { setLoadingDesc(false); }
  };
  const handleSchedule = async () => {
    if (!scheduledAt) return;
    setScheduling(true);
    try { await suppliersApi.schedule(product.id, new Date(scheduledAt).toISOString()); setShowSchedule(false); setScheduledAt(''); reload(); }
    catch (e: any) { alert(e?.response?.data?.message || 'שגיאה בתזמון'); }
    finally { setScheduling(false); }
  };

  return (
    <tr className="border-b border-edge hover:bg-white/[0.02] transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg overflow-hidden bg-white/[0.04] shrink-0">
            {product.image_url
              /* eslint-disable-next-line @next/next/no-img-element */
              ? <img src={yupooImg(product.image_url)} alt="" className="w-full h-full object-cover" loading="lazy" />
              : <div className="w-full h-full flex items-center justify-center"><Package size={16} className="text-white/20" /></div>}
          </div>
          <div className="min-w-0">
            <p className="text-xs text-white/75 line-clamp-1 leading-tight mb-1" dir="ltr">{product.title}</p>
            <div className="flex items-center gap-2 flex-wrap">
              {product.sku && <span className="text-2xs text-white/25" dir="ltr">#{product.sku}</span>}
              {product.has_post && <span className="px-1.5 py-0.5 bg-blue-500/15 border border-blue-500/25 text-[9px] text-blue-400 rounded-md font-medium">פוסט</span>}
            </div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-right"><p className="text-body font-semibold text-white">{s}{product.price}</p></td>
      <td className="px-4 py-3 text-right"><span className="text-2xs text-blue-400/70">{catalogName}</span></td>
      <td className="px-4 py-3">
        {product.in_stock === false
          ? <span className="inline-flex items-center px-2 py-0.5 rounded-md border text-xs font-medium bg-red-500/15 text-red-400 border-red-500/25">אזל</span>
          : <span className="inline-flex items-center px-2 py-0.5 rounded-md border text-xs font-medium bg-emerald-500/15 text-emerald-400 border-emerald-500/25">במלאי</span>}
      </td>
      <td className="px-4 py-3 text-right"><p className="text-xs text-white/30">{fmtDate(product.synced_at)}</p></td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-0.5">
          <ActionBtn icon={Trash2} label="מחק מוצר" onClick={handleDelete} color="red" />
          <ActionBtn icon={copied ? CheckCheck : Link2} label={copied ? 'הועתק!' : 'העתק קישור FLYLINK'} onClick={handleCopy} color="blue" />
          <ActionBtn icon={Sparkles} label="צור תיאור AI" onClick={handleDesc} color="purple" loading={loadingDesc} />
          <ActionBtn icon={FileText} label="צור פוסט" onClick={onCompose} color="purple" />
          <ActionBtn icon={Clock} label="תזמן פוסט" onClick={() => setShowSchedule(true)} color="purple" />
          <ActionBtn icon={queued ? CheckCheck : ListOrdered} label={queued ? 'נוסף לתור!' : 'הוסף לתור'} onClick={handleQueue} color="blue" loading={loadingQueue} />
          <ActionBtn icon={Pencil} label="ערוך מוצר" onClick={onEdit} color="blue" />
        </div>

        {showSchedule && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowSchedule(false)}>
            <div className="bg-surface-secondary border border-edge rounded-2xl p-5 w-[360px]" onClick={(e) => e.stopPropagation()} dir="rtl">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2"><Clock size={14} className="text-blue-400" /> תזמון פרסום</h3>
                <button onClick={() => setShowSchedule(false)} className="text-white/30 hover:text-white/60"><X size={14} /></button>
              </div>
              <p className="text-xs text-white/40 line-clamp-1 mb-3" dir="ltr">{product.title}</p>
              <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 mb-3">
                <AlertCircle size={12} className="text-amber-400 shrink-0 mt-0.5" />
                <p className="text-2xs text-amber-400">ייווצר טקסט אוטומטי (Gemini). לשליטה מלאה — &quot;צור פוסט&quot; ותזמן משם.</p>
              </div>
              <label className="block text-2xs text-white/40 mb-1.5">תאריך ושעה לפרסום</label>
              <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} min={minDateTime}
                className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500/50 mb-4" dir="ltr" />
              <button onClick={handleSchedule} disabled={!scheduledAt || scheduling}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-all">
                {scheduling ? <Loader2 size={13} className="animate-spin" /> : <Clock size={13} />}{scheduling ? 'מתזמן...' : 'תזמן פרסום'}
              </button>
            </div>
          </div>
        )}
      </td>
    </tr>
  );
}

function SupplierEditModal({ product, onClose, onSaved }: { product: SupplierProduct; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ title: product.title || '', price: String(product.price ?? ''), flylink_url: product.flylink_url || '', description: product.description || '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true); setError('');
    try {
      await suppliersApi.updateProduct(product.id, {
        title: form.title, price: parseFloat(form.price) || 0, flylink_url: form.flylink_url, description: form.description,
      } as any);
      onSaved();
    } catch (e: any) { setError(e?.response?.data?.message || 'שמירה נכשלה'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-surface-primary border border-edge rounded-2xl p-5 w-full max-w-lg" dir="rtl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">עריכת מוצר</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white/70"><X size={16} /></button>
        </div>
        <div className="space-y-3.5">
          <Field label="כותרת"><Input value={form.title} onChange={(v) => setForm((f) => ({ ...f, title: v }))} dir="ltr" /></Field>
          <Field label="מחיר"><Input value={form.price} onChange={(v) => setForm((f) => ({ ...f, price: v }))} dir="ltr" /></Field>
          <Field label="קישור שותפים FLYLINK"><Input value={form.flylink_url} onChange={(v) => setForm((f) => ({ ...f, flylink_url: v }))} dir="ltr" /></Field>
          <Field label="תיאור">
            <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3}
              className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/50 resize-none" dir="rtl" />
          </Field>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={save} disabled={saving || !form.title.trim()}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm font-medium rounded-xl">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} שמור
          </button>
          <button onClick={onClose} className="px-5 py-2.5 bg-white/5 hover:bg-white/10 text-white/60 text-sm rounded-xl">ביטול</button>
        </div>
      </div>
    </div>
  );
}

function LinkModal({ catalogs, initial, onClose, onDone }: { catalogs: SupplierCatalog[]; initial?: { catalogId?: string; yupooUrl?: string }; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ catalogId: initial?.catalogId || catalogs[0]?.id || '', yupooUrl: initial?.yupooUrl || '', flylinkUrl: '', code: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true); setError('');
    try {
      const r = await suppliersApi.link(form);
      if (!r.sku_verified) alert('נשמר — אך לא ניתן היה לאמת את הקוד מול FLYLINK אוטומטית (הקישור נשמר כפי שהודבק).');
      onDone();
    } catch (e: any) { setError(e?.response?.data?.message || 'החיבור נכשל'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-surface-primary border border-edge rounded-2xl p-5 w-full max-w-lg" dir="rtl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">חבר מוצר Yupoo ↔ FLYLINK</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white/70"><X size={16} /></button>
        </div>
        <div className="space-y-3.5">
          <Field label="קטלוג ספק">
            <select value={form.catalogId} onChange={(e) => setForm((f) => ({ ...f, catalogId: e.target.value }))}
              className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white/80 outline-none focus:border-blue-500/50">
              {catalogs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="קישור אלבום Yupoo" hint="מקור התוכן האמיתי (תמונה/מחיר/קוד)">
            <Input value={form.yupooUrl} onChange={(v) => setForm((f) => ({ ...f, yupooUrl: v }))} placeholder="https://…x.yupoo.com/albums/…" dir="ltr" />
          </Field>
          <Field label="קישור שותפים FLYLINK" hint="הקישור הייחודי שיצרת למוצר הזה ב-FLYLINK (כל מוצר וקישור משלו)">
            <Input value={form.flylinkUrl} onChange={(v) => setForm((f) => ({ ...f, flylinkUrl: v }))} placeholder="https://…flylinking.com/…" dir="ltr" />
          </Field>
          <Field label="קוד מוצר FLYLINK (מומלץ)" hint="לאימות שהקוד תואם ל-Yupoo — קישור השותפים אטום ולרוב לא מכיל קוד">
            <Input value={form.code} onChange={(v) => setForm((f) => ({ ...f, code: v }))} placeholder="LN1526" dir="ltr" />
          </Field>
          {error && <div className="flex items-center gap-2 text-xs text-red-400"><AlertTriangle size={13} /> {error}</div>}
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={submit} disabled={busy || !form.yupooUrl.trim() || !form.flylinkUrl.trim()}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm font-medium rounded-xl">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} חבר
          </button>
          <button onClick={onClose} className="px-5 py-2.5 bg-white/5 hover:bg-white/10 text-white/60 text-sm rounded-xl">ביטול</button>
        </div>
      </div>
    </div>
  );
}

// ─── Small UI helpers ─────────────────────────────────────────────────────────
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-white/50 mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-2xs text-white/25 mt-1">{hint}</p>}
    </div>
  );
}
function Input({ value, onChange, placeholder, dir }: { value: string; onChange: (v: string) => void; placeholder?: string; dir?: string }) {
  return (
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} dir={dir}
      className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/50 transition-colors" />
  );
}
