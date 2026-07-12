'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Store, Plus, Loader2, Trash2, Link2, Sparkles, Send, X,
  Package, CheckCircle2, AlertTriangle, Search, Pencil, Grid3x3, ChevronLeft,
} from 'lucide-react';
import { suppliersApi, channelsApi } from '@/lib/api-client';
import type { SupplierCatalog, SupplierProduct, SkuMatchMode, Channel } from '@/types';

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

  const load = useCallback(async () => {
    setProducts(await suppliersApi.listProducts().catch(() => []));
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const catName = (id: string) => catalogs.find((c) => c.id === id)?.name || 'ספק';

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
      {catalogs.length === 0 && <p className="text-xs text-amber-400 mb-4">צור קודם קטלוג ספק בטאב "קטלוגים"</p>}

      {mode === 'browse' ? (
        <StoreBrowser catalogs={catalogs} onPick={(catalogId, yupooUrl) => setLinkInit({ catalogId, yupooUrl })} />
      ) : loading ? (
        <div className="flex justify-center py-20"><Loader2 size={24} className="animate-spin text-blue-400" /></div>
      ) : products.length === 0 ? (
        <div className="bg-surface-secondary border border-dashed border-edge-hover rounded-2xl p-14 text-center">
          <Package size={32} className="text-white/15 mx-auto mb-3" />
          <p className="text-sm text-white/40">אין מוצרים מחוברים — "עיין בקטלוג" או "חבר מוצר ידני"</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {products.map((p) => (
            <SupplierProductCard key={p.id} product={p} catalogName={catName(p.supplier_catalog_id)} channels={channels} reload={load} />
          ))}
        </div>
      )}

      {linkInit && <LinkModal catalogs={catalogs} initial={linkInit} onClose={() => setLinkInit(null)} onDone={() => { setLinkInit(null); setMode('mine'); load(); }} />}
    </div>
  );
}

// ─── In-system Yupoo store browser ────────────────────────────────────────────
function StoreBrowser({ catalogs, onPick }: { catalogs: SupplierCatalog[]; onPick: (catalogId: string, yupooUrl: string) => void }) {
  const [catalogId, setCatalogId] = useState(catalogs[0]?.id || '');
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
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
            {items.map((it) => (
              <button key={it.album_url} onClick={() => onPick(catalogId, it.album_url)}
                className="text-right bg-surface-secondary border border-edge rounded-xl overflow-hidden hover:border-blue-500/40 hover:-translate-y-0.5 transition-all group">
                <div className="h-28 bg-white/[0.04]">
                  {it.thumb
                    /* eslint-disable-next-line @next/next/no-img-element */
                    ? <img src={it.thumb} alt="" className="w-full h-full object-cover" loading="lazy" />
                    : <div className="w-full h-full flex items-center justify-center"><Package size={20} className="text-white/15" /></div>}
                </div>
                <div className="p-2">
                  <p className="text-2xs text-white/70 truncate" dir="ltr">{it.description || it.code}</p>
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="text-xs font-bold text-white">${it.price}</span>
                    <span className="text-2xs text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5"><Link2 size={10} /> חבר</span>
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
    </div>
  );
}

function SupplierProductCard({ product, catalogName, channels, reload }: { product: SupplierProduct; catalogName: string; channels: Channel[]; reload: () => void }) {
  const [busy, setBusy] = useState<'' | 'desc' | 'queue'>('');
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);

  const gen = async () => {
    setBusy('desc'); setMsg(null);
    try { await suppliersApi.generateDescription(product.id); setMsg({ t: '✓ תיאור נוצר', ok: true }); reload(); }
    catch (e: any) { setMsg({ t: e?.response?.data?.message || 'שגיאה', ok: false }); }
    finally { setBusy(''); }
  };
  const queue = async (channelId?: string) => {
    setBusy('queue'); setMsg(null);
    try { const r = await suppliersApi.queue(product.id, channelId); setMsg({ t: `✓ נכנס לתור (${r.channel === 'default' ? 'ברירת מחדל' : 'קבוצה'})`, ok: true }); }
    catch (e: any) { setMsg({ t: e?.response?.data?.message || 'שגיאה', ok: false }); }
    finally { setBusy(''); }
  };

  return (
    <div className="bg-surface-secondary border border-edge rounded-xl overflow-hidden group">
      <div className="relative h-40 bg-white/[0.04]">
        {product.image_url
          /* eslint-disable-next-line @next/next/no-img-element */
          ? <img src={product.image_url} alt="" className="w-full h-full object-cover" loading="lazy" />
          : <div className="w-full h-full flex items-center justify-center"><Package size={26} className="text-white/15" /></div>}
        <span className="absolute top-2 right-2 bg-black/60 text-white text-2xs rounded-full px-2 py-0.5">{catalogName}</span>
        {product.in_stock === false && <span className="absolute top-2 left-2 bg-red-600/90 text-white text-2xs rounded-full px-2 py-0.5">אזל</span>}
        <button onClick={async () => { if (confirm('למחוק מוצר זה?')) { await suppliersApi.deleteProduct(product.id); reload(); } }}
          className="absolute bottom-2 left-2 w-7 h-7 rounded-full bg-black/55 hover:bg-red-600 text-white/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"><Trash2 size={12} /></button>
      </div>
      <div className="p-3">
        <p className="text-xs text-white/80 line-clamp-2 min-h-[2rem]" dir="ltr">{product.title}</p>
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-sm font-bold text-white">{product.currency === 'USD' ? '$' : ''}{product.price}</span>
          {product.sku && <span className="text-2xs text-white/30" dir="ltr">#{product.sku}</span>}
        </div>
        {msg && <p className={`text-2xs mt-2 ${msg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{msg.t}</p>}
        <div className="flex items-center gap-1.5 mt-2.5">
          <button onClick={() => queue()} disabled={busy !== ''}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-xs font-medium rounded-lg">
            {busy === 'queue' ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} הוסף לתור
          </button>
          <button onClick={gen} disabled={busy !== ''} title="צור תיאור AI"
            className="p-2 bg-violet-600/20 hover:bg-violet-600/30 disabled:opacity-60 border border-violet-500/30 text-violet-300 rounded-lg">
            {busy === 'desc' ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          </button>
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
