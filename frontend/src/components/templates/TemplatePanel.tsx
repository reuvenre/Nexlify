'use client';

import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, Check, X, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { templatesApi } from '@/lib/api-client';
import type { PostTemplate } from '@/types';

// ── Built-in templates ────────────────────────────────────────────────────────

export const BUILTIN: PostTemplate[] = [
  {
    id: 'builtin_default',
    name: 'ברירת מחדל',
    icon: '✨',
    content: '',
    builtin: true,
  },
  {
    id: 'builtin_price',
    name: 'מחיר וחיסכון',
    icon: '💰',
    content: 'כתוב פוסט שיווקי שמדגיש את המחיר הנמוך והחיסכון. פתח עם שאלה שמעוררת עניין כמו "מחפש X במחיר מעולה?". ציין בדיוק כמה חוסכים. כתוב בעברית בלבד עם אמוג\'ים.',
    builtin: true,
  },
  {
    id: 'builtin_features',
    name: 'תכונות המוצר',
    icon: '🔧',
    content: 'כתוב פוסט שמפרט 3-4 תכונות עיקריות של המוצר ברשימה ממוספרת עם אמוג\'ים. כל שורה - תכונה אחת. סיים עם מחיר ו"לחץ על הקישור להזמנה". כתוב בעברית.',
    builtin: true,
  },
  {
    id: 'builtin_fomo',
    name: 'דחיפות / FOMO',
    icon: '⏰',
    content: 'כתוב פוסט שיוצר תחושת דחיפות ופחד להחמיץ. הדגש שהמוצר פופולרי מאוד ושהמחיר עלול להשתנות. השתמש במילים כמו "מהר", "עכשיו", "אל תפספס". כתוב בעברית.',
    builtin: true,
  },
  {
    id: 'builtin_story',
    name: 'סיפור / רגשי',
    icon: '❤️',
    content: 'כתוב פוסט בסגנון סיפורי רגשי. ספר כיצד המוצר פותר בעיה יומיומית אמיתית. כתוב בגוף ראשון כאילו אתה מספר חוויה אישית. כתוב בעברית.',
    builtin: true,
  },
  {
    id: 'builtin_review',
    name: 'המלצה / ביקורת',
    icon: '⭐',
    content: 'כתוב פוסט בסגנון המלצה אישית. ציין את הדירוג הגבוה ומספר הרוכשים כהוכחה חברתית. כתוב כאילו אתה ממליץ לחברים. כתוב בעברית.',
    builtin: true,
  },
];

// ── Types ──────────────────────────────────────────────────────────────────────

interface TemplatePanelProps {
  selectedId: string;
  onSelect: (template: PostTemplate) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function TemplatePanel({ selectedId, onSelect }: TemplatePanelProps) {
  const [custom, setCustom] = useState<PostTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCustom, setShowCustom] = useState(true);

  // editor state
  const [editing, setEditing] = useState<PostTemplate | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', content: '', icon: '📝' });

  useEffect(() => {
    templatesApi.list()
      .then((ts) => setCustom(ts))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const openNew = () => {
    setForm({ name: '', content: '', icon: '📝' });
    setEditing(null);
    setIsNew(true);
  };

  const openEdit = (t: PostTemplate) => {
    setForm({ name: t.name, content: t.content, icon: t.icon });
    setEditing(t);
    setIsNew(false);
  };

  const cancelEdit = () => { setEditing(null); setIsNew(false); };

  const handleSave = async () => {
    if (!form.name.trim() || !form.content.trim()) return;
    setSaving(true);
    try {
      if (isNew) {
        const created = await templatesApi.create(form);
        setCustom((prev) => [...prev, { ...created, builtin: false }]);
        onSelect({ ...created, builtin: false });
      } else if (editing) {
        const updated = await templatesApi.update(editing.id, form);
        setCustom((prev) => prev.map((t) => t.id === editing.id ? { ...updated, builtin: false } : t));
        if (selectedId === editing.id) onSelect({ ...updated, builtin: false });
      }
      cancelEdit();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await templatesApi.remove(id);
    setCustom((prev) => prev.filter((t) => t.id !== id));
    if (selectedId === id) onSelect(BUILTIN[0]);
  };

  const allTemplates = [...BUILTIN, ...custom.map((t) => ({ ...t, builtin: false as const }))];

  return (
    <div className="bg-surface-secondary border border-edge rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-edge flex items-center justify-between">
        <p className="text-xs font-semibold text-white/60 uppercase tracking-wider">תבניות פוסט</p>
        <button
          onClick={openNew}
          className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
        >
          <Plus size={12} />
          חדשה
        </button>
      </div>

      {/* New / Edit form */}
      {(isNew || editing) && (
        <div className="p-3 border-b border-edge bg-blue-500/5 space-y-2">
          <div className="flex gap-2">
            <input
              value={form.icon}
              onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))}
              className="w-10 bg-white/5 border border-edge-hover rounded-lg px-2 py-1.5 text-sm text-center text-white outline-none focus:border-blue-500/50"
              maxLength={2}
              placeholder="📝"
            />
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="שם התבנית"
              className="flex-1 bg-white/5 border border-edge-hover rounded-lg px-3 py-1.5 text-sm text-white placeholder-white/25 outline-none focus:border-blue-500/50"
              dir="rtl"
            />
          </div>
          <textarea
            value={form.content}
            onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
            placeholder="הוראות לבינה המלאכותית — לדוגמה: 'כתוב פוסט קצר שמדגיש את המחיר. פתח עם שאלה...'"
            rows={4}
            className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2 text-xs text-white placeholder-white/20 outline-none focus:border-blue-500/50 resize-none leading-relaxed"
            dir="rtl"
          />
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving || !form.name.trim() || !form.content.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-xs font-medium rounded-lg transition-all"
            >
              {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
              {isNew ? 'צור תבנית' : 'שמור'}
            </button>
            <button
              onClick={cancelEdit}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white/50 text-xs rounded-lg transition-all"
            >
              <X size={11} />
              ביטול
            </button>
          </div>
        </div>
      )}

      {/* Built-in list */}
      <div className="p-2 space-y-0.5">
        <p className="text-[9px] text-white/25 uppercase tracking-wider px-2 py-1">מובנות</p>
        {BUILTIN.map((t) => (
          <TemplateRow
            key={t.id}
            template={t}
            isSelected={selectedId === t.id}
            onSelect={() => onSelect(t)}
          />
        ))}
      </div>

      {/* Custom list */}
      <div className="border-t border-edge">
        <button
          onClick={() => setShowCustom((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-2 text-[9px] text-white/25 uppercase tracking-wider hover:text-white/40 transition-colors"
        >
          <span>תבניות שלי ({custom.length})</span>
          {showCustom ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </button>

        {showCustom && (
          <div className="px-2 pb-2 space-y-0.5">
            {loading ? (
              <div className="flex justify-center py-3">
                <Loader2 size={14} className="animate-spin text-white/20" />
              </div>
            ) : custom.length === 0 ? (
              <p className="text-xs text-white/20 text-center py-3">
                אין תבניות עדיין — לחץ "+ חדשה"
              </p>
            ) : (
              custom.map((t) => (
                <TemplateRow
                  key={t.id}
                  template={t}
                  isSelected={selectedId === t.id}
                  onSelect={() => onSelect(t)}
                  onEdit={() => openEdit(t)}
                  onDelete={() => handleDelete(t.id)}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Row ────────────────────────────────────────────────────────────────────────

function TemplateRow({
  template, isSelected, onSelect, onEdit, onDelete,
}: {
  template: PostTemplate;
  isSelected: boolean;
  onSelect: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className={`group flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition-all
        ${isSelected
          ? 'bg-blue-600/20 border border-blue-500/30'
          : 'hover:bg-white/5 border border-transparent'
        }`}
      onClick={onSelect}
    >
      <span className="text-base shrink-0 w-6 text-center">{template.icon}</span>
      <span className={`flex-1 text-xs truncate ${isSelected ? 'text-blue-300 font-medium' : 'text-white/60'}`}>
        {template.name}
      </span>
      {isSelected && <Check size={11} className="text-blue-400 shrink-0" />}
      {!template.builtin && (
        <div className="hidden group-hover:flex items-center gap-1 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onEdit?.(); }}
            className="p-1 text-white/30 hover:text-white/70 rounded transition-colors"
          >
            <Pencil size={10} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete?.(); }}
            className="p-1 text-white/30 hover:text-red-400 rounded transition-colors"
          >
            <Trash2 size={10} />
          </button>
        </div>
      )}
    </div>
  );
}
