'use client';

import { useState, useEffect } from 'react';
import {
  Users, Plus, Trash2, CheckCircle2, XCircle,
  Loader2, Send, Eye, EyeOff, ToggleLeft, ToggleRight, Pencil,
} from 'lucide-react';
import { channelsApi } from '@/lib/api-client';
import type { Channel, CreateChannelInput, UpdateChannelInput } from '@/types';

const PLATFORM_ICON: Record<string, string> = { telegram: '📨' };
const PLATFORM_LABEL: Record<string, string> = { telegram: 'Telegram' };

// ── Shared form fields ────────────────────────────────────────────────────────

function ChannelFormFields({
  name, setName,
  botToken, setBotToken,
  channelId, setChannelId,
  description, setDescription,
  showToken, setShowToken,
  isEdit,
}: {
  name: string; setName: (v: string) => void;
  botToken: string; setBotToken: (v: string) => void;
  channelId: string; setChannelId: (v: string) => void;
  description: string; setDescription: (v: string) => void;
  showToken: boolean; setShowToken: (v: boolean) => void;
  isEdit?: boolean;
}) {
  return (
    <>
      <div>
        <label className="block text-xs text-white/50 mb-1.5">שם הערוץ *</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="למשל: ערוץ הדילים שלי"
          className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/50 transition-colors"
        />
      </div>

      {!isEdit && (
        <div>
          <label className="block text-xs text-white/50 mb-1.5">פלטפורמה</label>
          <select className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500/50 transition-colors">
            <option value="telegram">📨 Telegram</option>
          </select>
        </div>
      )}

      <div>
        <label className="block text-xs text-white/50 mb-1.5">Bot Token</label>
        <div className="relative">
          <input
            type={showToken ? 'text' : 'password'}
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            placeholder={isEdit ? 'השאר ריק לשמור על הנוכחי' : 'מ-@BotFather'}
            className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 pr-10 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/50 transition-colors"
            dir="ltr"
          />
          <button
            type="button"
            onClick={() => setShowToken(!showToken)}
            className="absolute top-1/2 right-3 -translate-y-1/2 text-white/30 hover:text-white/60"
          >
            {showToken ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </div>
        {isEdit && <p className="text-2xs text-white/25 mt-1">ממולא רק בעת עדכון הטוקן</p>}
      </div>

      <div>
        <label className="block text-xs text-white/50 mb-1.5">Channel ID</label>
        <input
          value={channelId}
          onChange={(e) => setChannelId(e.target.value)}
          placeholder="@mychannel, -100123456789, או 1002382502297"
          className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/50 transition-colors"
          dir="ltr"
        />
      </div>

      <div>
        <label className="block text-xs text-white/50 mb-1.5">תיאור (אופציונלי)</label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="למשל: ערוץ אלקטרוניקה"
          className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/50 transition-colors"
        />
      </div>
    </>
  );
}

// ── Add modal ────────────────────────────────────────────────────────────────

function AddChannelModal({ onClose, onAdd }: { onClose: () => void; onAdd: (c: Channel) => void }) {
  const [name, setName] = useState('');
  const [botToken, setBotToken] = useState('');
  const [channelId, setChannelId] = useState('');
  const [description, setDescription] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('שם ערוץ נדרש'); return; }
    setSaving(true);
    setError('');
    try {
      const channel = await channelsApi.create({
        name: name.trim(),
        platform: 'telegram',
        bot_token: botToken || undefined,
        channel_id: channelId || undefined,
        description: description || undefined,
      } as CreateChannelInput);
      onAdd(channel);
      onClose();
    } catch {
      setError('שגיאה ביצירת הערוץ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-surface-secondary border border-edge-hover rounded-2xl w-full max-w-md p-6">
        <h2 className="text-base font-semibold text-white mb-5">הוסף ערוץ חדש</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <ChannelFormFields
            name={name} setName={setName}
            botToken={botToken} setBotToken={setBotToken}
            channelId={channelId} setChannelId={setChannelId}
            description={description} setDescription={setDescription}
            showToken={showToken} setShowToken={setShowToken}
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 bg-white/5 hover:bg-white/10 text-white/60 text-sm rounded-xl transition-all">
              ביטול
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-all">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              הוסף ערוץ
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Edit modal ────────────────────────────────────────────────────────────────

function EditChannelModal({
  channel,
  onClose,
  onSave,
}: {
  channel: Channel;
  onClose: () => void;
  onSave: (updated: Channel) => void;
}) {
  const [name, setName] = useState(channel.name);
  const [botToken, setBotToken] = useState('');
  const [channelId, setChannelId] = useState(channel.channel_id);
  const [description, setDescription] = useState(channel.description);
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('שם ערוץ נדרש'); return; }
    setSaving(true);
    setError('');
    try {
      const dto: UpdateChannelInput = {
        name: name.trim(),
        channel_id: channelId,
        description,
      };
      if (botToken.trim()) dto.bot_token = botToken.trim();
      const updated = await channelsApi.update(channel.id, dto);
      onSave(updated);
      onClose();
    } catch {
      setError('שגיאה בשמירת הערוץ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-surface-secondary border border-edge-hover rounded-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-white">עריכת ערוץ</h2>
          <span className="text-xs text-white/30 bg-white/5 px-2.5 py-1 rounded-lg">
            {PLATFORM_ICON[channel.platform]} {PLATFORM_LABEL[channel.platform]}
          </span>
        </div>

        {/* Token status banner */}
        <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg mb-4 ${
          channel.has_token
            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
            : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
        }`}>
          {channel.has_token
            ? <>✓ טוקן מוגדר ({channel.bot_token_masked}) — ממלא רק לעדכון</>
            : <>⚠ אין טוקן מוגדר — הכנס טוקן מ-@BotFather</>}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <ChannelFormFields
            name={name} setName={setName}
            botToken={botToken} setBotToken={setBotToken}
            channelId={channelId} setChannelId={setChannelId}
            description={description} setDescription={setDescription}
            showToken={showToken} setShowToken={setShowToken}
            isEdit
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 bg-white/5 hover:bg-white/10 text-white/60 text-sm rounded-xl transition-all">
              ביטול
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-all">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Pencil size={14} />}
              שמור שינויים
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Channel card ─────────────────────────────────────────────────────────────

function ChannelCard({
  channel,
  onDelete,
  onTest,
  onToggle,
  onEdit,
}: {
  channel: Channel;
  onDelete: (id: string) => void;
  onTest: (id: string) => Promise<{ ok: boolean; error?: string }>;
  onToggle: (id: string, active: boolean) => void;
  onEdit: (channel: Channel) => void;
}) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    const result = await onTest(channel.id);
    setTestResult(result);
    setTesting(false);
    setTimeout(() => setTestResult(null), 5000);
  };

  const handleDelete = async () => {
    if (!confirm(`למחוק את "${channel.name}"?`)) return;
    setDeleting(true);
    onDelete(channel.id);
  };

  return (
    <div className="bg-surface-secondary border border-edge rounded-xl p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-xl shrink-0">
            {PLATFORM_ICON[channel.platform]}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white truncate">{channel.name}</p>
            <p className="text-xs text-white/40">
              {PLATFORM_LABEL[channel.platform]} · {channel.channel_id || 'ללא Channel ID'}
            </p>
            {channel.members_count > 0 && (
              <p className="text-xs text-white/50 mt-0.5">
                <Users size={10} className="inline-block mr-1 mb-0.5" />
                {channel.members_count.toLocaleString()} חברים
              </p>
            )}
            {channel.description && (
              <p className="text-xs text-white/30 mt-0.5 truncate">{channel.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onEdit(channel)}
            className="p-1.5 text-white/30 hover:text-blue-400 hover:bg-blue-400/10 rounded-lg transition-colors"
            title="ערוך ערוץ"
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={() => onToggle(channel.id, !channel.is_active)}
            className="p-1 text-white/30 hover:text-white/60 transition-colors"
            title={channel.is_active ? 'השבת' : 'הפעל'}
          >
            {channel.is_active
              ? <ToggleRight size={22} className="text-blue-400" />
              : <ToggleLeft size={22} />}
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="p-1.5 text-white/20 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
            title="מחק"
          >
            {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className={`flex-1 text-xs px-3 py-1.5 rounded-lg ${channel.is_active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-white/5 text-white/30'}`}>
          {channel.is_active ? 'פעיל' : 'מושבת'}
          {channel.has_token ? ' · טוקן מוגדר' : ' · אין טוקן'}
        </div>

        <button
          onClick={handleTest}
          disabled={testing}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-60 text-white/60 text-xs rounded-lg transition-all"
        >
          {testing ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
          בדוק חיבור
        </button>

        {testResult && (
          <div className={`flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg ${testResult.ok ? 'text-emerald-400 bg-emerald-500/10' : 'text-red-400 bg-red-500/10'}`}>
            {testResult.ok
              ? <><CheckCircle2 size={12} /> הצלחה</>
              : <><XCircle size={12} /> {testResult.error || 'שגיאה'}</>}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function GroupsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [platformFilter, setPlatformFilter] = useState<string>('הכל');

  useEffect(() => {
    channelsApi.list()
      .then(setChannels)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = async (id: string) => {
    await channelsApi.delete(id).catch(() => {});
    setChannels((cs) => cs.filter((c) => c.id !== id));
  };

  const handleTest = (id: string) => channelsApi.test(id);

  const handleToggle = async (id: string, active: boolean) => {
    const updated = await channelsApi.update(id, { is_active: active }).catch(() => null);
    if (updated) setChannels((cs) => cs.map((c) => c.id === id ? updated : c));
  };

  const handleSaveEdit = (updated: Channel) => {
    setChannels((cs) => cs.map((c) => c.id === updated.id ? updated : c));
  };

  const totalMembers = channels.reduce((s, c) => s + (c.members_count || 0), 0);
  const activeChannels = channels.filter((c) => c.is_active).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">ניהול ערוצים</h1>
          <p className="text-sm text-white/40 mt-1">נהל את ערוצי הפרסום שלך ב-Telegram (WhatsApp ואינסטגרם — בקרוב)</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-xl transition-all"
        >
          <Plus size={15} />
          הוסף ערוץ
        </button>
      </div>

      {/* Stats */}
      {!loading && channels.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'סה״כ ערוצים',  value: channels.length, icon: '📋' },
            { label: 'סה״כ חברים',   value: totalMembers.toLocaleString(), icon: '👥' },
            { label: 'פלטפורמות',    value: 1, icon: '🌐' },
            { label: 'פרסום אוטו',   value: activeChannels, icon: '🤖' },
          ].map(({ label, value, icon }) => (
            <div key={label} className="bg-surface-secondary border border-edge rounded-xl p-4 flex items-center gap-3">
              <span className="text-xl">{icon}</span>
              <div>
                <p className="text-xl font-bold text-white">{value}</p>
                <p className="text-xs text-white/40">{label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Platform filters intentionally removed — only Telegram is live today, so a
          filter row (with WhatsApp/Facebook/Instagram options that match nothing)
          just looked broken. Restore once a second platform ships. */}

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 size={24} className="animate-spin text-blue-400" />
        </div>
      ) : channels.length === 0 ? (
        <div className="bg-surface-secondary border border-dashed border-edge-hover rounded-2xl p-16 text-center">
          <Users size={36} className="text-white/15 mx-auto mb-4" />
          <p className="text-sm font-medium text-white/40 mb-1">אין ערוצים עדיין</p>
          <p className="text-xs text-white/20 mb-6">הוסף ערוצי Telegram לפרסום פוסטים</p>
          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-xl transition-all"
          >
            <Plus size={15} />
            הוסף ערוץ ראשון
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {channels
            .filter((c) => platformFilter === 'הכל' || PLATFORM_LABEL[c.platform]?.toLowerCase() === platformFilter.toLowerCase())
            .map((channel) => (
            <ChannelCard
              key={channel.id}
              channel={channel}
              onDelete={handleDelete}
              onTest={handleTest}
              onToggle={handleToggle}
              onEdit={setEditingChannel}
            />
          ))}
        </div>
      )}

      {showAddModal && (
        <AddChannelModal
          onClose={() => setShowAddModal(false)}
          onAdd={(c) => setChannels((cs) => [...cs, c])}
        />
      )}

      {editingChannel && (
        <EditChannelModal
          channel={editingChannel}
          onClose={() => setEditingChannel(null)}
          onSave={handleSaveEdit}
        />
      )}
    </div>
  );
}
