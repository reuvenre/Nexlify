'use client';

import { useCallback, useEffect, useState } from 'react';
import { ShieldAlert, Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';
import { adminApi } from '@/lib/api-client';
import type { SecurityEvent } from '@/types';

const TYPE_META: Record<string, { label: string; cls: string; icon: string }> = {
  login_failed: { label: 'התחברות כושלת', cls: 'bg-red-500/10 text-red-300', icon: '🔴' },
  login_success: { label: 'התחברות', cls: 'bg-emerald-500/10 text-emerald-300', icon: '🟢' },
  password_reset_requested: { label: 'בקשת איפוס סיסמה', cls: 'bg-amber-500/10 text-amber-300', icon: '🔑' },
  role_changed: { label: 'שינוי הרשאה', cls: 'bg-violet-500/10 text-violet-300', icon: '👤' },
  admin_created: { label: 'אדמין נוצר', cls: 'bg-violet-500/15 text-violet-200', icon: '⚠️' },
  decrypt_failed: { label: 'כשל בפענוח', cls: 'bg-red-500/15 text-red-200', icon: '🔓' },
};

const FILTERS = [
  { value: '', label: 'הכל' },
  { value: 'login_failed', label: 'התחברויות כושלות' },
  { value: 'role_changed', label: 'שינויי הרשאה' },
  { value: 'admin_created', label: 'אדמינים חדשים' },
  { value: 'password_reset_requested', label: 'איפוסי סיסמה' },
];

export default function AdminSecurityPage() {
  const { user } = useAuth();
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    adminApi.securityEvents(filter || undefined)
      .then(setEvents)
      .catch(() => setError('טעינת יומן האבטחה נכשלה'))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  if (user && user.role !== 'admin') {
    return <div className="text-center py-20"><h1 className="text-xl font-bold text-white">גישת מנהל בלבד</h1></div>;
  }

  const fmt = (d: string) => new Date(d).toLocaleString('he-IL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <ShieldAlert size={19} className="text-red-400" /> יומן אבטחה
          </h1>
          <p className="text-sm text-white/40 mt-1">
            התחברויות, שינויי הרשאה ואירועים רגישים. השומר סורק את היומן ומתריע על Brute-force והסלמת הרשאות.
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 disabled:opacity-50 text-white/70 text-sm rounded-xl transition-all">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> רענן
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button key={f.value} onClick={() => setFilter(f.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              filter === f.value ? 'bg-blue-600 text-white' : 'bg-white/5 text-white/50 hover:text-white/80'
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/25 text-red-300 text-sm rounded-xl px-4 py-3 flex items-center gap-2">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      <div className="bg-surface-secondary border border-edge rounded-xl overflow-hidden">
        {loading ? (
          <div className="py-16 flex justify-center"><Loader2 size={22} className="animate-spin text-blue-400" /></div>
        ) : events.length === 0 ? (
          <div className="py-16 text-center text-white/40">אין אירועים להצגה</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-white/40 text-xs border-b border-edge">
                  <th className="text-right font-medium py-3 px-4">אירוע</th>
                  <th className="text-right font-medium py-3 px-4">חשבון</th>
                  <th className="text-right font-medium py-3 px-4">IP</th>
                  <th className="text-right font-medium py-3 px-4">פרטים</th>
                  <th className="text-right font-medium py-3 px-4">זמן</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => {
                  const m = TYPE_META[e.type] || { label: e.type, cls: 'bg-white/10 text-white/50', icon: '•' };
                  return (
                    <tr key={e.id} className="border-t border-edge hover:bg-white/[0.02]">
                      <td className="py-2.5 px-4">
                        <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${m.cls}`}>
                          {m.icon} {m.label}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-white/70" dir="ltr">{e.email || e.user_id || '—'}</td>
                      <td className="py-2.5 px-4 text-white/50 font-mono text-xs" dir="ltr">{e.ip || '—'}</td>
                      <td className="py-2.5 px-4 text-white/40 text-xs max-w-[200px] truncate" dir="ltr" title={e.detail || ''}>{e.detail || '—'}</td>
                      <td className="py-2.5 px-4 text-white/40 text-xs whitespace-nowrap">{fmt(e.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
