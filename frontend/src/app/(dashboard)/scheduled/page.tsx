'use client';

import { useEffect, useState, useCallback } from 'react';
import { CalendarClock, Loader2, Trash2, Power, Plus, Save, X, Repeat, Send } from 'lucide-react';
import { customPostsApi, channelsApi } from '@/lib/api-client';
import { GroupMultiSelect, type GroupOption } from '@/components/GroupMultiSelect';
import type { CustomPost, CustomPostRepeat } from '@/types';

/** ISO → <input type="datetime-local"> value (local tz); default = now + 1h. */
function toLocalInput(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date(Date.now() + 3600_000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

const REPEAT_LABEL: Record<CustomPostRepeat, string> = { none: 'חד-פעמי', daily: 'כל יום', weekly: 'כל שבוע' };

const EMPTY = () => ({
  id: '' as string,
  name: '',
  body: '',
  imagesText: '',
  channels: [] as string[],
  sendAt: toLocalInput(),
  repeat: 'none' as CustomPostRepeat,
});

export default function ScheduledPostsPage() {
  const [posts, setPosts] = useState<CustomPost[]>([]);
  const [channels, setChannels] = useState<GroupOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [p] = await Promise.all([
      customPostsApi.list().catch(() => [] as CustomPost[]),
      channelsApi.list().then((l) => setChannels(l.map((c) => ({ id: c.id, name: c.name, channel_id: c.channel_id })))).catch(() => {}),
    ]);
    setPosts(p);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const groupNames = (ids?: string[] | null) =>
    (ids || []).map((id) => channels.find((c) => c.channel_id === id)?.name || id).join(', ');

  const resetForm = () => setForm(EMPTY());

  const editPost = (p: CustomPost) => setForm({
    id: p.id, name: p.name || '', body: p.body,
    imagesText: (p.image_urls || []).join('\n'),
    channels: p.target_channels || [],
    sendAt: toLocalInput(p.send_at), repeat: p.repeat,
  });

  const save = async () => {
    if (!form.body.trim()) { setError('כתוב תוכן לפוסט'); return; }
    if (!form.channels.length) { setError('בחר לפחות קבוצת יעד אחת'); return; }
    setSaving(true); setError('');
    const payload = {
      name: form.name.trim(),
      body: form.body,
      image_urls: form.imagesText.split('\n').map((s) => s.trim()).filter(Boolean),
      target_channels: form.channels,
      send_at: new Date(form.sendAt).toISOString(),
      repeat: form.repeat,
    };
    try {
      if (form.id) await customPostsApi.update(form.id, payload);
      else await customPostsApi.create(payload);
      resetForm();
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'השמירה נכשלה');
    } finally { setSaving(false); }
  };

  const toggle = async (p: CustomPost) => { await customPostsApi.update(p.id, { enabled: !p.enabled }).catch(() => {}); load(); };
  const remove = async (p: CustomPost) => { if (confirm(`למחוק את הפוסט "${p.name || 'ללא שם'}"?`)) { await customPostsApi.remove(p.id).catch(() => {}); load(); } };

  const fmt = (d?: string | null) => d ? new Date(d).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

  return (
    <div dir="rtl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <CalendarClock size={22} className="text-blue-400" /> פוסטים מתוזמנים
        </h1>
        <p className="text-sm text-white/40 mt-1">
          פוסטים שאתה כותב מראש ומגדיר מתי הם יישלחו. הם מסתנכרנים עם תור הפרסום — נכנסים למשבצת הפנויה הבאה של הקבוצה, בלי להתנגש עם הטייס האוטומטי.
        </p>
      </div>

      {/* ── Composer ── */}
      <section className="bg-surface-secondary border border-edge rounded-2xl p-5 mb-6 space-y-4">
        <h2 className="text-sm font-semibold text-white">{form.id ? 'עריכת פוסט מתוזמן' : 'פוסט מתוזמן חדש'}</h2>

        <div>
          <label className="block text-xs text-white/50 mb-1.5">שם (לזיהוי בלבד)</label>
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="למשל: מבצע סופ״ש" className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2 text-sm text-white/85 outline-none focus:border-blue-500/50" />
        </div>

        <div>
          <label className="block text-xs text-white/50 mb-1.5">תוכן הפוסט *</label>
          <textarea value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} rows={5}
            placeholder="הטקסט המדויק שיפורסם..." className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white/85 outline-none focus:border-blue-500/50 resize-y" />
        </div>

        <div>
          <label className="block text-xs text-white/50 mb-1.5">קישורי תמונות (אחד בכל שורה, אופציונלי)</label>
          <textarea value={form.imagesText} onChange={(e) => setForm((f) => ({ ...f, imagesText: e.target.value }))} rows={2} dir="ltr"
            placeholder="https://...jpg" className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2 text-xs text-white/80 outline-none focus:border-blue-500/50 font-mono resize-y" />
        </div>

        <div>
          <label className="block text-xs text-white/50 mb-1.5">קבוצות יעד *</label>
          <GroupMultiSelect channels={channels} value={form.channels} onChange={(ids) => setForm((f) => ({ ...f, channels: ids }))} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-white/50 mb-1.5">מתי לשלוח</label>
            <input type="datetime-local" value={form.sendAt} onChange={(e) => setForm((f) => ({ ...f, sendAt: e.target.value }))}
              className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2 text-sm text-white/80 outline-none focus:border-blue-500/50" />
          </div>
          <div>
            <label className="block text-xs text-white/50 mb-1.5">חזרתיות</label>
            <select value={form.repeat} onChange={(e) => setForm((f) => ({ ...f, repeat: e.target.value as CustomPostRepeat }))}
              className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2 text-sm text-white/80 outline-none focus:border-blue-500/50">
              <option value="none">חד-פעמי</option>
              <option value="daily">כל יום</option>
              <option value="weekly">כל שבוע</option>
            </select>
          </div>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex items-center gap-3">
          <button onClick={save} disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-all">
            {saving ? <Loader2 size={14} className="animate-spin" /> : form.id ? <Save size={14} /> : <Plus size={14} />}
            {form.id ? 'שמור שינויים' : 'הוסף פוסט מתוזמן'}
          </button>
          {form.id && (
            <button onClick={resetForm} className="flex items-center gap-1.5 px-4 py-2.5 bg-white/5 hover:bg-white/10 text-white/60 text-sm rounded-xl">
              <X size={14} /> ביטול
            </button>
          )}
        </div>
      </section>

      {/* ── List ── */}
      <section className="bg-surface-secondary border border-edge rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-edge">
          <h3 className="text-sm font-semibold text-white">הפוסטים המתוזמנים שלי ({posts.length})</h3>
        </div>
        {loading ? (
          <div className="py-12 flex justify-center"><Loader2 size={20} className="animate-spin text-blue-400" /></div>
        ) : posts.length === 0 ? (
          <p className="py-12 text-center text-sm text-white/40">אין עדיין פוסטים מתוזמנים — הוסף אחד למעלה.</p>
        ) : (
          <div className="divide-y divide-edge">
            {posts.map((p) => (
              <div key={p.id} className="flex items-start gap-4 px-5 py-3.5 hover:bg-white/[0.02]">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span className="text-sm font-medium text-white/85">{p.name || 'ללא שם'}</span>
                    <span className="text-2xs bg-white/5 border border-edge rounded-full px-2 py-0.5 text-white/50 flex items-center gap-1">
                      <Repeat size={9} /> {REPEAT_LABEL[p.repeat]}
                    </span>
                    {!p.enabled && <span className="text-2xs bg-amber-500/10 text-amber-400 border border-amber-500/25 rounded-full px-2 py-0.5">מושהה</span>}
                    {p.sent_count > 0 && <span className="text-2xs text-white/30">נשלח {p.sent_count}×</span>}
                  </div>
                  <p className="text-xs text-white/50 truncate">{p.body}</p>
                  <p className="text-2xs text-white/30 mt-0.5">
                    {groupNames(p.target_channels)} · {p.enabled ? `הבא: ${fmt(p.next_send_at)}` : `אחרון: ${fmt(p.last_sent_at)}`}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => editPost(p)} title="ערוך" className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-blue-400 hover:bg-blue-500/10"><Send size={13} /></button>
                  <button onClick={() => toggle(p)} title={p.enabled ? 'השהה' : 'הפעל'} className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-amber-400 hover:bg-amber-500/10"><Power size={13} /></button>
                  <button onClick={() => remove(p)} title="מחק" className="w-7 h-7 rounded-lg flex items-center justify-center text-red-400/60 hover:text-red-400 hover:bg-red-500/10"><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
