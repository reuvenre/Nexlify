'use client';

import { useState, useEffect } from 'react';
import { FileText, Plus, Check, Pencil, Trash2, X, Loader2, Save } from 'lucide-react';
import { templatesApi, credentialsApi } from '@/lib/api-client';
import type { PostTemplate } from '@/types';

// ── Built-in body templates (read-only, not stored in DB) ─────────────────────

const BUILTIN_BODY: PostTemplate[] = [
  {
    id: 'builtin_default',
    name: 'תבנית ברירת מחדל',
    icon: '✨',
    content: '',
    type: 'body',
    builtin: true,
  },
  {
    id: 'builtin_price',
    name: 'מחיר וחיסכון',
    icon: '💰',
    content: 'כתוב פוסט שיווקי שמדגיש את המחיר הנמוך והחיסכון. פתח עם שאלה שמעוררת עניין. ציין בדיוק כמה חוסכים. כתוב בעברית עם אמוג\'ים.',
    type: 'body',
    builtin: true,
  },
  {
    id: 'builtin_fomo',
    name: 'דחיפות / FOMO',
    icon: '⏰',
    content: 'כתוב פוסט שיוצר תחושת דחיפות ופחד להחמיץ. הדגש שהמחיר עלול להשתנות. השתמש במילים כמו "מהר", "עכשיו", "אל תפספס". כתוב בעברית.',
    type: 'body',
    builtin: true,
  },
  {
    id: 'builtin_review',
    name: 'המלצה / ביקורת',
    icon: '⭐',
    content: 'כתוב פוסט בסגנון המלצה אישית. ציין את הדירוג הגבוה ומספר הרוכשים. כתוב כאילו אתה ממליץ לחברים. כתוב בעברית.',
    type: 'body',
    builtin: true,
  },
];

// Sample preview texts for builtin templates
const BUILTIN_PREVIEWS: Record<string, string> = {
  builtin_default: '✨ אוזניות Bluetooth איכותיות\n\n🔧 אוזניות עם תמיכה בבלוטוס, סוללה ל-20 שעות עם סאונד ברור ועשיר\n\n💰 מחיר: ₪149\n🏷️ הנחה: 33%\n\n🔗 קישור לרכישה',
  builtin_price:   '💰 מחפש אוזניות במחיר מעולה?\n\n✅ חוסך ₪75 ביחס למחיר המקורי!\n\n🔧 אוזניות Bluetooth איכותיות, סוללה ל-20 שעות\n\n💵 רק ₪149 — הנחה 33%!\n\n🔗 להזמנה',
  builtin_fomo:    '⏰ עכשיו או לעולם לא!\n\n🔥 אוזניות Bluetooth — רק ₪149!\nהמחיר הזה לא יישמר לנצח!\n\n⚡ מהר לפני שנגמר!\n\n🔗 לחץ כאן לרכישה מיידית',
  builtin_review:  '⭐ 4.9/5 — 2,300 רוכשים מרוצים!\n\nבדקתי את האוזניות האלה ואני חייב להמליץ — הסאונד מדהים, הסוללה מחזיקה 20 שעות\n\n💰 ₪149 בלבד\n\n🔗 קישור לרכישה',
};

// ── Template form modal (create & edit) ──────────────────────────────────────

interface TemplateModalProps {
  initial?: PostTemplate | null;
  templateType: 'body' | 'footer';
  onClose: () => void;
  onSaved: (t: PostTemplate) => void;
}

function TemplateModal({ initial, templateType, onClose, onSaved }: TemplateModalProps) {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name || '');
  const [icon, setIcon] = useState(initial?.icon || (templateType === 'footer' ? '📌' : '📝'));
  const [content, setContent] = useState(initial?.content || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!name.trim() || !content.trim()) {
      setError('נא למלא שם ותוכן');
      return;
    }
    setSaving(true);
    setError('');
    try {
      let saved: PostTemplate;
      if (isEdit && initial) {
        saved = await templatesApi.update(initial.id, { name: name.trim(), content: content.trim(), icon: icon.trim() || '📝' });
      } else {
        saved = await templatesApi.create({ name: name.trim(), content: content.trim(), icon: icon.trim() || '📝', type: templateType });
      }
      onSaved({ ...saved, type: templateType, builtin: false });
      onClose();
    } catch {
      setError('שגיאה בשמירה — נסה שוב');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-surface-secondary border border-edge-hover rounded-2xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-bold text-white">
            {isEdit ? 'עריכת תבנית' : templateType === 'footer' ? 'הוסף כותרת תחתונה' : 'צור תבנית חדשה'}
          </h2>
          <button onClick={onClose} className="text-white/30 hover:text-white/60 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4">
          {/* Name + icon */}
          <div className="flex gap-3">
            <div className="shrink-0">
              <label className="block text-xs text-white/50 mb-1.5">אייקון</label>
              <input
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                maxLength={2}
                className="w-14 text-center bg-white/5 border border-edge-hover rounded-xl px-2 py-2.5 text-lg text-white outline-none focus:border-blue-500/50"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-white/50 mb-1.5">שם התבנית *</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={templateType === 'footer' ? 'לדוגמה: כותרת ערוץ הדילים' : 'לדוגמה: תבנית מבצעי קיץ'}
                className="w-full bg-white/5 border border-edge-hover rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/50"
              />
            </div>
          </div>

          {/* Content */}
          <div>
            <label className="block text-xs text-white/50 mb-1.5">
              {templateType === 'footer'
                ? 'טקסט הכותרת התחתונה *'
                : 'הוראות לבינה מלאכותית *'}
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={5}
              placeholder={
                templateType === 'footer'
                  ? 'לדוגמה: 📢 ערוץ הדילים הכי חם! @mychannel | linktr.ee/mystore'
                  : 'לדוגמה: כתוב פוסט שמדגיש את ההנחה ויוצר תחושת דחיפות. פתח עם שאלה...'
              }
              className="w-full bg-white/5 border border-edge-hover rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/50 resize-none leading-relaxed"
            />
            <p className="text-2xs text-white/25 mt-1 text-left">{content.length} תווים</p>
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        <div className="flex gap-3 mt-5">
          <button
            onClick={handleSave}
            disabled={saving || !name.trim() || !content.trim()}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-all"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? 'שומר...' : isEdit ? 'שמור שינויים' : 'צור תבנית'}
          </button>
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-white/5 hover:bg-white/10 text-white/60 text-sm rounded-xl transition-all"
          >
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Template card ─────────────────────────────────────────────────────────────

function TemplateCard({
  template,
  isSelected,
  onSelect,
  onEdit,
  onDelete,
}: {
  template: PostTemplate;
  isSelected: boolean;
  onSelect: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const previewText = template.builtin
    ? (BUILTIN_PREVIEWS[template.id] || template.content)
    : template.content;

  const handleDelete = async () => {
    if (!confirm(`למחוק את "${template.name}"?`)) return;
    setDeleting(true);
    try {
      await templatesApi.remove(template.id);
      onDelete?.();
    } catch {
      setDeleting(false);
    }
  };

  return (
    <div
      className={`bg-surface-secondary rounded-2xl border overflow-hidden transition-all flex flex-col
        ${isSelected ? 'border-blue-500/50 ring-1 ring-blue-500/20' : 'border-edge hover:border-white/20'}`}
    >
      {/* Card header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-edge">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg shrink-0">{template.icon}</span>
          <span className="text-sm font-semibold text-white truncate">{template.name}</span>
          <span className="text-2xs bg-white/8 text-white/40 border border-edge-hover rounded-full px-2 py-0.5 shrink-0">
            {template.builtin ? 'System' : 'Custom'}
          </span>
        </div>
        {!template.builtin && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={onEdit}
              className="p-1.5 text-white/25 hover:text-blue-400 hover:bg-blue-400/10 rounded-lg transition-all"
              title="ערוך"
            >
              <Pencil size={13} />
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="p-1.5 text-white/25 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all"
              title="מחק"
            >
              {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            </button>
          </div>
        )}
      </div>

      {/* Preview */}
      <div className="px-4 py-3 flex-1">
        <p className="text-2xs font-semibold text-white/35 uppercase tracking-wider mb-2">תצוגה מקדימה</p>
        <div className="bg-white/3 border border-edge rounded-xl p-3 min-h-[90px]">
          <p className="text-xs text-white/60 leading-relaxed whitespace-pre-line line-clamp-6">{previewText}</p>
        </div>
      </div>

      {/* Select button */}
      <div className="px-4 pb-4">
        <button
          onClick={onSelect}
          className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all
            ${isSelected
              ? 'bg-blue-600/20 border border-blue-500/40 text-blue-400'
              : 'bg-white/5 border border-edge-hover text-white/50 hover:bg-white/10 hover:text-white/80'}`}
        >
          {isSelected && <Check size={13} />}
          {isSelected ? 'Selected ✓' : 'Select Template'}
        </button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TemplatesPage() {
  const [tab, setTab] = useState<'body' | 'footer'>('body');
  const [customTemplates, setCustomTemplates] = useState<PostTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBodyId, setSelectedBodyId] = useState('builtin_default');
  const [selectedFooterId, setSelectedFooterId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<PostTemplate | null>(null);
  const [savedFlash, setSavedFlash] = useState('');

  // Load saved templates + the persisted default selections from backend
  useEffect(() => {
    Promise.all([
      templatesApi.list().then((ts) => setCustomTemplates(ts.map((t) => ({ ...t, builtin: false })))),
      credentialsApi.get()
        .then((c) => {
          if (c.default_body_template_id) setSelectedBodyId(c.default_body_template_id);
          setSelectedFooterId(c.default_footer_template_id || null);
        })
        .catch(() => {}),
    ])
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Persist a default selection to the backend so it survives reloads and is
  // used when posts are sent (footer) / pre-selected (body).
  const persistDefault = async (type: 'body' | 'footer', id: string | null) => {
    try {
      await credentialsApi.upsert(
        type === 'body'
          ? { default_body_template_id: id || 'builtin_default' }
          : { default_footer_template_id: id || '' },
      );
      setSavedFlash(type === 'body' ? 'תבנית הגוף נשמרה כברירת מחדל ✓' : 'הכותרת התחתונה נשמרה ✓');
      setTimeout(() => setSavedFlash(''), 2500);
    } catch {
      setSavedFlash('שגיאה בשמירה');
      setTimeout(() => setSavedFlash(''), 2500);
    }
  };

  const handleSelect = (type: 'body' | 'footer', id: string) => {
    if (type === 'body') setSelectedBodyId(id);
    else setSelectedFooterId((prev) => (prev === id ? null : id)); // click again to deselect footer
    persistDefault(type, type === 'footer' && selectedFooterId === id ? null : id);
  };

  const bodyTemplates = [
    ...BUILTIN_BODY,
    ...customTemplates.filter((t) => !t.type || t.type === 'body'),
  ];
  const footerTemplates = customTemplates.filter((t) => t.type === 'footer');

  const handleSaved = (saved: PostTemplate) => {
    setCustomTemplates((prev) => {
      const exists = prev.find((t) => t.id === saved.id);
      if (exists) return prev.map((t) => t.id === saved.id ? saved : t);
      return [...prev, saved];
    });
  };

  const handleDeleted = (id: string) => {
    setCustomTemplates((prev) => prev.filter((t) => t.id !== id));
    if (selectedBodyId === id) { setSelectedBodyId('builtin_default'); persistDefault('body', null); }
    if (selectedFooterId === id) { setSelectedFooterId(null); persistDefault('footer', null); }
  };

  const openCreate = () => { setEditingTemplate(null); setShowModal(true); };
  const openEdit = (t: PostTemplate) => { setEditingTemplate(t); setShowModal(true); };

  const currentTemplates = tab === 'body' ? bodyTemplates : footerTemplates;
  const currentSelectedId = tab === 'body' ? selectedBodyId : selectedFooterId;

  return (
    <div dir="rtl">
      {showModal && (
        <TemplateModal
          initial={editingTemplate}
          templateType={tab}
          onClose={() => { setShowModal(false); setEditingTemplate(null); }}
          onSaved={handleSaved}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 text-white/30 text-xs mb-1">
            <FileText size={12} />
            <span>תבניות פוסטים</span>
          </div>
          <h1 className="text-2xl font-bold text-white">תבניות פוסטים</h1>
          <p className="text-sm text-white/40 mt-1">צור ונהל תבניות פוסטים</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-xl transition-all"
        >
          <Plus size={14} />
          {tab === 'footer' ? '+ כותרת תחתונה' : 'צור תבנית'}
        </button>
      </div>

      {/* Saved flash */}
      {savedFlash && (
        <div className="mb-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-2.5 text-sm text-emerald-400 flex items-center gap-2">
          <Check size={14} /> {savedFlash}
        </div>
      )}

      {/* Tabs */}
      <div className="flex bg-surface-secondary border border-edge rounded-xl p-1 gap-1 mb-6 w-fit">
        {[
          { v: 'body' as const, l: 'תבניות גוף' },
          { v: 'footer' as const, l: 'כותרות תחתונות לקבוצות' },
        ].map(({ v, l }) => (
          <button
            key={v}
            onClick={() => setTab(v)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all
              ${tab === v ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'}`}
          >
            {l}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 size={24} className="animate-spin text-blue-400" />
        </div>
      ) : currentTemplates.length === 0 ? (
        /* Empty state for footer tab */
        <div className="bg-surface-secondary border border-dashed border-edge-hover rounded-2xl p-16 text-center">
          <FileText size={36} className="text-white/15 mx-auto mb-4" />
          <p className="text-sm text-white/40 mb-1">אין כותרות תחתונות עדיין</p>
          <p className="text-xs text-white/25 mb-5">כותרת תחתונה מתווספת בסוף כל פוסט שנשלח לערוץ</p>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-xl transition-all"
          >
            <Plus size={14} />
            הוסף כותרת תחתונה ראשונה
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {currentTemplates.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              isSelected={currentSelectedId === t.id}
              onSelect={() => handleSelect(tab, t.id)}
              onEdit={() => openEdit(t)}
              onDelete={() => handleDeleted(t.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
