'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Users, Shield, Loader2, Mail, BadgeCheck, RefreshCw, UserPlus, Send,
  Ban, CheckCircle2, X, Settings2, AlertTriangle,
} from 'lucide-react';
import { StatCard } from '@/components/common/StatCard';
import { adminApi, subscriptionApi } from '@/lib/api-client';
import { useAuth } from '@/lib/hooks/useAuth';
import type { AdminUser, AdminStats, PlanDef, BroadcastResult } from '@/types';

export default function AdminUsersPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [plans, setPlans] = useState<PlanDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [managing, setManaging] = useState<AdminUser | null>(null);
  const [adding, setAdding] = useState(false);
  const [broadcasting, setBroadcasting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([adminApi.stats(), adminApi.users(), subscriptionApi.plans().catch(() => [])])
      .then(([s, u, p]) => { setStats(s); setUsers(u); setPlans(p); setForbidden(false); })
      .catch((e) => { if (e?.response?.status === 403) setForbidden(true); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (forbidden || (user && user.role !== 'admin')) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <Shield size={32} className="text-white/20 mb-4" />
        <h1 className="text-xl font-bold text-white">גישת מנהל בלבד</h1>
        <p className="text-sm text-white/40 mt-2">העמוד הזה זמין רק למשתמשי אדמין.</p>
      </div>
    );
  }

  const fmtDate = (d: string) => new Date(d).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const planName = (id?: string) => plans.find((p) => p.id === id)?.name || id || '—';
  const blockedCount = users.filter((u) => u.is_blocked).length;

  return (
    <div>
      <div className="mb-6 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Users size={22} className="text-blue-400" /> ניהול משתמשים
          </h1>
          <p className="text-sm text-white/40 mt-1">הוספה, הרשאות, מנויים, חסימה ושליחת תפוצה</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setBroadcasting(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-violet-600/15 hover:bg-violet-600/25 border border-violet-500/30 text-violet-200 text-sm rounded-xl transition-all">
            <Send size={14} /> שלח תפוצה
          </button>
          <button onClick={() => setAdding(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600/90 hover:bg-blue-600 text-white text-sm font-medium rounded-xl transition-all">
            <UserPlus size={14} /> הוסף משתמש
          </button>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 disabled:opacity-50 text-white/70 text-sm rounded-xl transition-all">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> רענן
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="סך משתמשים" value={stats?.total_users ?? 0} icon={Users} accent="blue" />
        <StatCard label="מנהלים" value={stats?.admins ?? 0} icon={Shield} accent="violet" />
        <StatCard label="דרך Google" value={stats?.google_users ?? 0} icon={BadgeCheck} accent="green" />
        <StatCard label="חסומים" value={blockedCount} icon={Ban} accent="amber" />
      </div>

      <section className="bg-surface-secondary border border-edge rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-edge flex items-center gap-2">
          <Mail size={15} className="text-white/40" />
          <h3 className="text-sm font-semibold text-white">רשומים ({users.length})</h3>
        </div>

        {loading ? (
          <div className="py-12 flex justify-center"><Loader2 size={20} className="animate-spin text-blue-400" /></div>
        ) : users.length === 0 ? (
          <p className="py-12 text-center text-sm text-white/40">אין עדיין משתמשים רשומים.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-right text-2xs text-white/35 border-b border-edge">
                  <th className="px-5 py-2.5 font-medium">אימייל</th>
                  <th className="px-3 py-2.5 font-medium">תפקיד</th>
                  <th className="px-3 py-2.5 font-medium">מנוי</th>
                  <th className="px-3 py-2.5 font-medium">סטטוס</th>
                  <th className="px-3 py-2.5 font-medium text-center">פוסטים</th>
                  <th className="px-3 py-2.5 font-medium text-center">טייסים</th>
                  <th className="px-3 py-2.5 font-medium">הצטרף</th>
                  <th className="px-3 py-2.5 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-edge last:border-0 hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-3 text-white/80" dir="ltr">
                      <div className="flex items-center gap-2 justify-end">
                        {u.via_google && <BadgeCheck size={13} className="text-green-400/70 shrink-0" />}
                        <span className="truncate">{u.email}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`text-2xs px-2 py-0.5 rounded-full border ${u.role === 'admin'
                        ? 'bg-violet-500/10 text-violet-300 border-violet-500/25'
                        : 'bg-white/5 text-white/45 border-edge'}`}>
                        {u.role === 'admin' ? 'אדמין' : 'משתמש'}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-white/60">{planName(u.subscription_plan)}</td>
                    <td className="px-3 py-3">
                      {u.is_blocked ? (
                        <span className="inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-300 border border-red-500/25">
                          <Ban size={10} /> חסום
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-300 border border-green-500/25">
                          <CheckCircle2 size={10} /> פעיל
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-center text-white/60">{u.posts_count}</td>
                    <td className="px-3 py-3 text-center text-white/60">{u.campaigns_count}</td>
                    <td className="px-3 py-3 text-white/45">{fmtDate(u.created_at)}</td>
                    <td className="px-3 py-3">
                      <button onClick={() => setManaging(u)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-blue-500/10 text-xs text-white/60 hover:text-blue-300 border border-transparent hover:border-blue-500/20 transition-all">
                        <Settings2 size={12} /> נהל
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {managing && (
        <ManageUserModal
          user={managing} plans={plans} isSelf={managing.id === user?.id}
          onClose={() => setManaging(null)}
          onSaved={() => { setManaging(null); load(); }}
        />
      )}
      {adding && (
        <AddUserModal plans={plans} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />
      )}
      {broadcasting && (
        <BroadcastModal onClose={() => setBroadcasting(false)} />
      )}
    </div>
  );
}

// ─── Modal shell ──────────────────────────────────────────────────────────────
function ModalShell({ title, icon, onClose, children }: { title: string; icon: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-surface-secondary border border-edge rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-edge sticky top-0 bg-surface-secondary">
          <h3 className="text-base font-semibold text-white flex items-center gap-2">{icon} {title}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all"><X size={16} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

const inputCls = 'w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white/85 outline-none focus:border-blue-500/50';
const labelCls = 'block text-xs text-white/50 mb-1.5';

// ─── Manage user modal (role / plan / block) ───────────────────────────────────
function ManageUserModal({ user, plans, isSelf, onClose, onSaved }: {
  user: AdminUser; plans: PlanDef[]; isSelf: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [role, setRole] = useState<'user' | 'admin'>(user.role);
  const [plan, setPlan] = useState<string>(user.subscription_plan || 'starter');
  const [blocked, setBlocked] = useState<boolean>(!!user.is_blocked);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true); setError('');
    try {
      if (role !== user.role) await adminApi.setRole(user.id, role);
      if (plan !== (user.subscription_plan || 'starter')) await adminApi.setSubscription(user.id, plan);
      if (blocked !== !!user.is_blocked) await adminApi.setBlocked(user.id, blocked);
      onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'שמירה נכשלה — נסה שוב');
      setSaving(false);
    }
  };

  return (
    <ModalShell title="ניהול משתמש" icon={<Settings2 size={17} className="text-blue-400" />} onClose={onClose}>
      <p className="text-sm text-white/70 mb-4 truncate" dir="ltr">{user.email}</p>

      <div className="space-y-4">
        <div>
          <label className={labelCls}>הרשאה</label>
          <select value={role} onChange={(e) => setRole(e.target.value as 'user' | 'admin')} className={inputCls} disabled={isSelf}>
            <option value="user">משתמש</option>
            <option value="admin">אדמין</option>
          </select>
          {isSelf && <p className="text-2xs text-white/30 mt-1">אי אפשר לשנות את ההרשאה של עצמך.</p>}
        </div>

        <div>
          <label className={labelCls}>מנוי</label>
          <select value={plan} onChange={(e) => setPlan(e.target.value)} className={inputCls}>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>{p.name} — {p.monthly_credits} קרדיטים/חודש</option>
            ))}
          </select>
          <p className="text-2xs text-white/30 mt-1">שינוי מנוי מאפס את מכסת הקרדיטים החודשית.</p>
        </div>

        <div>
          <label className={labelCls}>סטטוס חשבון</label>
          <button
            type="button"
            disabled={isSelf}
            onClick={() => setBlocked((b) => !b)}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border transition-all disabled:opacity-50 ${
              blocked ? 'bg-red-500/10 border-red-500/30 text-red-300' : 'bg-green-500/10 border-green-500/30 text-green-300'
            }`}
          >
            <span className="flex items-center gap-2 text-sm">
              {blocked ? <Ban size={14} /> : <CheckCircle2 size={14} />}
              {blocked ? 'חסום (לא יכול להתחבר)' : 'פעיל'}
            </span>
            <span className="text-2xs text-white/40">{blocked ? 'לחץ לביטול חסימה' : 'לחץ לחסימה'}</span>
          </button>
          {isSelf && <p className="text-2xs text-white/30 mt-1">אי אפשר לחסום את עצמך.</p>}
        </div>

        {error && <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertTriangle size={12} /> {error}</p>}

        <div className="flex gap-2 pt-1">
          <button onClick={save} disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm font-medium transition-all">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} שמור שינויים
          </button>
          <button onClick={onClose} className="px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 text-sm transition-all">ביטול</button>
        </div>
      </div>
    </ModalShell>
  );
}

// ─── Add user modal ─────────────────────────────────────────────────────────────
function AddUserModal({ plans, onClose, onSaved }: { plans: PlanDef[]; onClose: () => void; onSaved: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [plan, setPlan] = useState('starter');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true); setError('');
    try {
      await adminApi.createUser({ email: email.trim(), password, role, plan });
      onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'יצירת המשתמש נכשלה');
      setSaving(false);
    }
  };

  return (
    <ModalShell title="הוספת משתמש" icon={<UserPlus size={17} className="text-blue-400" />} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className={labelCls}>אימייל</label>
          <input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>סיסמה ראשונית</label>
          <input type="text" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="לפחות 6 תווים" className={inputCls} />
          <p className="text-2xs text-white/30 mt-1">מסור למשתמש — הוא יוכל לשנות אותה דרך &quot;שכחתי סיסמה&quot;.</p>
        </div>
        <div>
          <label className={labelCls}>הרשאה</label>
          <select value={role} onChange={(e) => setRole(e.target.value as 'user' | 'admin')} className={inputCls}>
            <option value="user">משתמש</option>
            <option value="admin">אדמין</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>מנוי</label>
          <select value={plan} onChange={(e) => setPlan(e.target.value)} className={inputCls}>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {error && <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertTriangle size={12} /> {error}</p>}

        <div className="flex gap-2 pt-1">
          <button onClick={save} disabled={saving || !email.trim() || !password}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm font-medium transition-all">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />} צור משתמש
          </button>
          <button onClick={onClose} className="px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 text-sm transition-all">ביטול</button>
        </div>
      </div>
    </ModalShell>
  );
}

// ─── Broadcast modal (email / Telegram / WhatsApp) ──────────────────────────────
type Chan = 'email' | 'telegram' | 'whatsapp';

function BroadcastModal({ onClose }: { onClose: () => void }) {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [target, setTarget] = useState<'all' | 'users' | 'admins'>('all');
  const [chans, setChans] = useState<Chan[]>(['email']);
  const [waNumbers, setWaNumbers] = useState('');
  const [waMode, setWaMode] = useState<'text' | 'template'>('text');
  const [tplName, setTplName] = useState('');
  const [tplLang, setTplLang] = useState('he');
  const [tplParams, setTplParams] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<BroadcastResult | null>(null);

  const toggle = (c: Chan) => setChans((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]);

  const send = async () => {
    setSending(true); setError(''); setResult(null);
    try {
      const r = await adminApi.broadcast({
        subject: subject.trim(), message: message.trim(), target,
        channels: chans,
        whatsapp_numbers: chans.includes('whatsapp') ? waNumbers : undefined,
        whatsapp_mode: chans.includes('whatsapp') ? waMode : undefined,
        whatsapp_template_name: chans.includes('whatsapp') && waMode === 'template' ? tplName.trim() : undefined,
        whatsapp_template_lang: chans.includes('whatsapp') && waMode === 'template' ? tplLang.trim() : undefined,
        whatsapp_template_params: chans.includes('whatsapp') && waMode === 'template' ? tplParams : undefined,
      });
      setResult(r);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'שליחת התפוצה נכשלה');
    } finally {
      setSending(false);
    }
  };

  const CHAN_META: { id: Chan; label: string }[] = [
    { id: 'email', label: 'אימייל' },
    { id: 'telegram', label: 'טלגרם (הקבוצות שלי)' },
    { id: 'whatsapp', label: 'וואטסאפ' },
  ];

  const ResultLine = ({ label, r }: { label: string; r?: BroadcastResult['whatsapp'] }) => {
    if (!r) return null;
    if (r.configured === false) return (
      <p className="text-xs text-amber-400 flex items-center gap-1.5"><AlertTriangle size={12} /> {label}: לא מוגדר — לא נשלח.</p>
    );
    if (r.note === 'no_numbers') return (
      <p className="text-xs text-amber-400 flex items-center gap-1.5"><AlertTriangle size={12} /> {label}: לא הוזנו מספרים.</p>
    );
    return (
      <div className="text-xs">
        <p className={`flex items-center gap-1.5 ${r.failed && !r.sent ? 'text-amber-400' : 'text-white/70'}`}>
          {r.failed && !r.sent ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} className="text-green-400" />}
          {label}: נשלחו {r.sent}/{r.total}{r.failed ? ` · ${r.failed} נכשלו` : ''}.
        </p>
        {r.error && r.failed > 0 && <p className="text-2xs text-red-400/70 mt-0.5 pr-4" dir="ltr">{r.error}</p>}
      </div>
    );
  };

  return (
    <ModalShell title="שליחת הודעת תפוצה" icon={<Send size={17} className="text-violet-400" />} onClose={onClose}>
      {result ? (
        <div className="py-2">
          <CheckCircle2 size={30} className="text-green-400 mx-auto mb-3" />
          <div className="space-y-2 bg-white/[0.03] border border-edge rounded-lg p-3">
            <ResultLine label="אימייל" r={result.email} />
            <ResultLine label="טלגרם" r={result.telegram} />
            <ResultLine label="וואטסאפ" r={result.whatsapp} />
          </div>
          <button onClick={onClose} className="mt-5 w-full px-5 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 text-sm transition-all">סגור</button>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className={labelCls}>ערוצי שליחה</label>
            <div className="flex flex-wrap gap-2">
              {CHAN_META.map((c) => {
                const on = chans.includes(c.id);
                return (
                  <button key={c.id} type="button" onClick={() => toggle(c.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                      on ? 'bg-violet-600/20 border-violet-500/50 text-violet-200' : 'bg-white/5 border-edge-hover text-white/50 hover:text-white/80'
                    }`}>
                    <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${on ? 'bg-violet-500 border-violet-500' : 'border-white/30'}`}>
                      {on && <CheckCircle2 size={10} className="text-white" />}
                    </span>
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>

          {chans.includes('email') && (
            <div>
              <label className={labelCls}>נמעני אימייל</label>
              <select value={target} onChange={(e) => setTarget(e.target.value as any)} className={inputCls}>
                <option value="all">כל המשתמשים</option>
                <option value="users">משתמשים רגילים בלבד</option>
                <option value="admins">מנהלים בלבד</option>
              </select>
            </div>
          )}

          {chans.includes('whatsapp') && (
            <div className="space-y-3 border border-edge rounded-lg p-3 bg-white/[0.02]">
              <div>
                <label className={labelCls}>מספרי וואטסאפ</label>
                <textarea value={waNumbers} onChange={(e) => setWaNumbers(e.target.value)} rows={2} dir="ltr"
                  placeholder="972501234567, 972521112233"
                  className={`${inputCls} resize-y`} />
                <p className="text-2xs text-white/30 mt-1">מספרים בפורמט בינלאומי (ללא +), מופרדים בפסיק/רווח. דורש WhatsApp Business מוגדר בהגדרות.</p>
              </div>

              <div>
                <label className={labelCls}>סוג שליחה</label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setWaMode('text')}
                    className={`flex-1 px-3 py-2 rounded-lg border text-xs font-medium transition-all ${waMode === 'text' ? 'bg-green-600/20 border-green-500/50 text-green-200' : 'bg-white/5 border-edge-hover text-white/50'}`}>
                    טקסט חופשי (חלון 24ש׳)
                  </button>
                  <button type="button" onClick={() => setWaMode('template')}
                    className={`flex-1 px-3 py-2 rounded-lg border text-xs font-medium transition-all ${waMode === 'template' ? 'bg-green-600/20 border-green-500/50 text-green-200' : 'bg-white/5 border-edge-hover text-white/50'}`}>
                    תבנית מאושרת (שליחה קרה)
                  </button>
                </div>
              </div>

              {waMode === 'template' ? (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className={labelCls}>שם התבנית</label>
                      <input value={tplName} onChange={(e) => setTplName(e.target.value)} dir="ltr" placeholder="order_update" className={inputCls} />
                    </div>
                    <div className="w-28">
                      <label className={labelCls}>שפה</label>
                      <input value={tplLang} onChange={(e) => setTplLang(e.target.value)} dir="ltr" placeholder="he" className={inputCls} />
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>ערכים למשתני התבנית</label>
                    <input value={tplParams} onChange={(e) => setTplParams(e.target.value)} placeholder="ערך1 | ערך2 | ערך3" className={inputCls} />
                    <p className="text-2xs text-white/30 mt-1">ממלאים את {'{{1}}'}, {'{{2}}'}... בסדר, מופרדים ב-|. השם + השפה חייבים להיות זהים לתבנית שאושרה ב-Meta.</p>
                  </div>
                </div>
              ) : (
                <p className="text-2xs text-amber-400/80 flex items-start gap-1.5">
                  <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                  טקסט חופשי מגיע רק למי שכתב לך ב-24 השעות האחרונות. לשליחה קרה השתמש בתבנית מאושרת.
                </p>
              )}
            </div>
          )}

          <div>
            <label className={labelCls}>נושא (אימייל)</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="נושא ההודעה" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>תוכן ההודעה</label>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5}
              placeholder="כתוב כאן את תוכן ההודעה שתישלח..."
              className={`${inputCls} resize-y leading-relaxed`} />
          </div>

          {error && <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertTriangle size={12} /> {error}</p>}

          <div className="flex gap-2 pt-1">
            {(() => {
              const needsMessage = chans.includes('email') || chans.includes('telegram') || (chans.includes('whatsapp') && waMode === 'text');
              const templateOk = !(chans.includes('whatsapp') && waMode === 'template') || tplName.trim();
              const canSend = !!chans.length && (!needsMessage || !!message.trim()) && !!templateOk;
              return (
                <button onClick={send} disabled={sending || !canSend}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white text-sm font-medium transition-all">
                  {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} שלח
                </button>
              );
            })()}
            <button onClick={onClose} className="px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 text-sm transition-all">ביטול</button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}
