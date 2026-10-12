'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Megaphone, FileText, DollarSign, MousePointerClick, BadgeDollarSign,
  AlertCircle, CheckCircle2, Circle, ChevronLeft,
  Users, Zap, Bot,
} from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';
import { useLive } from '@/lib/hooks/useLive';
import { useVizColors } from '@/lib/viz';
import { postsApi, earningsApi, credentialsApi, channelsApi, subscriptionApi, campaignsApi, statsApi } from '@/lib/api-client';
import { AiUsagePanel } from '@/components/dashboard/AiUsagePanel';
import { ClickleadRoiPanel } from '@/components/dashboard/ClickleadRoiPanel';
import { OverviewPanel } from '@/components/dashboard/OverviewPanel';
import { LiveBadge } from '@/components/dashboard/live/LiveBadge';
import { StatTile } from '@/components/dashboard/live/StatTile';
import { DailyChart } from '@/components/dashboard/live/DailyChart';
import { NowPanel } from '@/components/dashboard/live/NowPanel';

const nf = (v: number) => Math.round(v).toLocaleString('he-IL');
const usd = (v: number) => `$${v.toFixed(2)}`;
const ils = (v: number) => `₪${Math.round(v).toLocaleString('he-IL')}`;

// ── Onboarding steps ──────────────────────────────────────────────────────────

interface SetupStep {
  id: string;
  label: string;
  desc: string;
  href: string;
  done: boolean;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuth();
  const colors = useVizColors();
  // Everything that moves during the day — one cheap call, every 20 s while on screen.
  const live = useLive(() => statsApi.live(30), { intervalMs: 20_000 });
  // The slower account picture: recent posts, the month's earnings, setup state.
  const base = useLive(async () => {
    const [posts, earn, creds, channels, sub] = await Promise.all([
      postsApi.list({ limit: 6 }),
      earningsApi.summary({ period: 'month' }),
      credentialsApi.get().catch(() => null),
      channelsApi.list().catch(() => []),
      subscriptionApi.status().catch(() => null),
    ]);
    return { posts, earn, creds, channels, sub };
  }, { intervalMs: 45_000 });
  // Facebook token countdown — a dead token silently kills IG/FB publishing, so the
  // dashboard warns from 14 days out.
  const [tokenDaysLeft, setTokenDaysLeft] = useState<number | null>(null);
  // Active commercial-calendar seasons (auto keywords + copy context in campaigns).
  const [seasons, setSeasons] = useState<Array<{ key: string; name: string; emoji: string }>>([]);

  const displayName = user?.name?.trim() || user?.email?.split('@')[0] || 'משתמש';

  useEffect(() => {
    credentialsApi.tokenStatus()
      .then((s) => setTokenDaysLeft(s.days_left))
      .catch(() => {});
    campaignsApi.seasonal()
      .then((s) => setSeasons(s.active))
      .catch(() => {});
  }, []);

  const L = live.data;
  const B = base.data;
  const isLoading = base.loading && !B;
  const earnings = B?.earn ?? null;
  const subscription = B?.sub ?? null;
  const recentPosts = B?.posts.data ?? [];
  const channels = B?.channels ?? [];
  // Groups that carry their OWN Facebook page token and are running out. The account-level
  // banner below says "הטוקן הראשי" and nothing about these, so a group token used to lapse
  // with no warning anywhere — and an owner with several pages could not tell which token an
  // alert was even about. Each of these names its group.
  const expiringGroups = channels
    .filter((c) => c.has_fb_token && c.fb_token_days_left != null && c.fb_token_days_left <= 14)
    .map((c) => ({ id: c.id, name: c.name, days: c.fb_token_days_left as number }))
    .sort((a, b) => a.days - b.days);
  // The server reports whether AI generation actually works — including via the shared
  // server key. Reading the key fields instead kept the step marked incomplete for users
  // whose AI was working fine, with no way to ever tick it off.
  const steps: SetupStep[] = B && L ? [
    { id: 'ali',      label: 'חבר את AliExpress',     desc: 'הגדר App Key ו-App Secret',     href: '/settings',         done: !!B.creds?.aliexpress_app_key },
    { id: 'ai',       label: 'חבר מנוע AI',            desc: 'מפתח API ליצירת תוכן — Gemini / OpenAI / Claude', href: '/settings', done: !!B.creds?.ai_ready },
    { id: 'channel',  label: 'הוסף ערוץ טלגרם',        desc: 'חבר ערוץ לפרסום אוטומטי',       href: '/groups',           done: channels.length > 0 },
    { id: 'campaign', label: 'הגדר טייס אוטומטי',        desc: 'הפעל פרסום אוטומטי של מוצרים', href: '/campaigns/new',    done: L.campaigns.total > 0 },
    { id: 'post',     label: 'שלח פוסט ראשון',         desc: 'פרסם מוצר לטלגרם',             href: '/quick-post',       done: (B.posts.total ?? 0) > 0 },
  ] : [];
  const refreshAll = () => { void live.refresh(); void base.refresh(); };

  const totalEarnings = earnings ? earnings.total_settled + earnings.total_estimated : 0;
  const completedSteps = steps.filter((s) => s.done).length;
  const allDone = steps.length > 0 && completedSteps === steps.length;
  const nextStep = steps.find((s) => !s.done);

  return (
    <div>
      {/* Facebook-token expiry banner — shown from 14 days out, red once ≤7/expired. */}
      {tokenDaysLeft !== null && tokenDaysLeft <= 14 && (
        <Link
          href="/settings"
          className={`flex items-center gap-3 rounded-xl border px-4 py-3 mb-6 transition-all hover:opacity-90
            ${tokenDaysLeft <= 7
              ? 'bg-red-500/10 border-red-500/30 text-red-300'
              : 'bg-amber-500/10 border-amber-500/30 text-amber-300'}`}
        >
          <AlertCircle size={18} className="shrink-0" />
          <div className="flex-1 text-sm">
            {tokenDaysLeft < 0
              ? 'הטוקן הראשי של פייסבוק (הגדרות ← אינטגרציות) פג תוקף — פרסום לאינסטגרם ופייסבוק מושבת! לחץ לחידוש.'
              : `הטוקן הראשי של פייסבוק (הגדרות ← אינטגרציות) יפוג בעוד ${tokenDaysLeft} ימים — חדש אותו כדי שהפרסום לאינסטגרם ופייסבוק לא ייעצר.`}
          </div>
          <ChevronLeft size={16} className="shrink-0 opacity-60" />
        </Link>
      )}

      {/* One banner PER GROUP that has its own token running out — named, because
          "טוקן הפייסבוק" is exactly what left the owner unable to tell which one. */}
      {expiringGroups.map((g) => (
        <Link
          key={g.id}
          href="/groups"
          className={`flex items-center gap-3 rounded-xl border px-4 py-3 mb-6 transition-all hover:opacity-90
            ${g.days <= 7
              ? 'bg-red-500/10 border-red-500/30 text-red-300'
              : 'bg-amber-500/10 border-amber-500/30 text-amber-300'}`}
        >
          <AlertCircle size={18} className="shrink-0" />
          <div className="flex-1 text-sm">
            {g.days < 0
              ? `הטוקן של הקבוצה "${g.name}" פג תוקף — הפרסום שלה לפייסבוק ולאינסטגרם מושבת. שאר הקבוצות ממשיכות כרגיל.`
              : `הטוקן של הקבוצה "${g.name}" יפוג בעוד ${g.days} ימים — חדש אותו במסך קבוצות.`}
          </div>
          <ChevronLeft size={16} className="shrink-0 opacity-60" />
        </Link>
      ))}

      {/* Active commercial seasons — the campaigns are automatically riding these. */}
      {seasons.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-6">
          <span className="text-2xs text-white/30">🗓️ עונות פעילות (מילות מפתח וקופי עונתיים פועלים אוטומטית):</span>
          {seasons.map((s) => (
            <span key={s.key} className="text-xs bg-amber-500/10 border border-amber-500/25 text-amber-300 rounded-full px-2.5 py-1">
              {s.emoji} {s.name}
            </span>
          ))}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">שלום, {displayName}!</h1>
          <p className="text-sm text-white/40 mt-1">
            {new Date().toLocaleDateString('he-IL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <LiveBadge
          updatedAt={live.updatedAt}
          error={live.error}
          refreshing={live.loading}
          onRefresh={refreshAll}
        />
      </div>

      {/* Onboarding checklist */}
      {!allDone && steps.length > 0 && (
        <div className="card p-5 mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Zap size={15} className="text-blue-400" />
              <p className="text-sm font-semibold text-white">הגדר את החשבון שלך</p>
            </div>
            <span className="text-xs text-white/40 bg-white/5 px-2.5 py-1 rounded-full">
              {completedSteps} / {steps.length} שלבים הושלמו
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-1.5 bg-white/5 rounded-full mb-5 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-violet-500 rounded-full transition-all duration-700"
              style={{ width: `${(completedSteps / steps.length) * 100}%` }}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
            {steps.map((step, i) => (
              <Link
                key={step.id}
                href={step.done ? '#' : step.href}
                className={`flex flex-col gap-1.5 p-3 rounded-xl border transition-all
                  ${step.done
                    ? 'bg-emerald-500/5 border-emerald-500/20 cursor-default'
                    : nextStep?.id === step.id
                      ? 'bg-blue-500/10 border-blue-500/30 hover:bg-blue-500/15'
                      : 'bg-white/3 border-edge hover:bg-white/5'
                  }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-2xs font-semibold uppercase tracking-wider
                    ${step.done ? 'text-emerald-400' : 'text-white/30'}`}>
                    {i + 1}
                  </span>
                  {step.done
                    ? <CheckCircle2 size={14} className="text-emerald-400" />
                    : nextStep?.id === step.id
                      ? <ChevronLeft size={14} className="text-blue-400" />
                      : <Circle size={14} className="text-white/15" />
                  }
                </div>
                <p className={`text-xs font-medium ${step.done ? 'text-white/50' : nextStep?.id === step.id ? 'text-white' : 'text-white/40'}`}>
                  {step.label}
                </p>
                <p className="text-2xs text-white/25 leading-relaxed">{step.desc}</p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Today, live — each number glides to its new value as the day moves. */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4 mb-6">
        <StatTile
          label="קליקים היום" icon={MousePointerClick} value={L ? L.today.clicks : null} format={nf}
          sub={L ? `${nf(L.last_hour.clicks)} בשעה האחרונה` : undefined}
          spark={L?.daily.clicks} sparkDays={L?.days} sparkColor={colors.clicks}
        />
        <StatTile
          label="פוסטים שיצאו היום" icon={FileText} value={L ? L.today.posts_sent : null} format={nf}
          sub={L ? `${nf(L.queue.scheduled + L.queue.queued)} ממתינים בתור` : undefined}
          spark={L?.daily.posts} sparkDays={L?.days} sparkColor={colors.posts}
        />
        <StatTile
          label="עמלות היום" icon={BadgeDollarSign} value={L ? L.today.commissions_usd : null} format={usd}
          sub={L ? `${nf(L.today.orders ?? 0)} הזמנות · לפי היום של אלי אקספרס` : undefined}
          spark={L?.daily.commissions_usd} sparkDays={L?.commission_days ?? L?.days} sparkColor={colors.commissions}
        />
        <StatTile
          label="הכנסות החודש" icon={DollarSign} value={earnings ? earnings.total_settled + earnings.total_estimated : null} format={ils}
          sub={earnings ? `${ils(earnings.total_settled)} מוסדר` : undefined} href="/reports"
        />
        <StatTile
          label="טייסים פעילים" icon={Megaphone} value={L ? L.campaigns.active : null} format={nf}
          sub={L ? `מתוך ${nf(L.campaigns.total)} · ${nf(channels.length)} ערוצים` : undefined} href="/campaigns"
        />
        <StatTile
          label={`קרדיטים (${subscription?.plan_name || '—'})`} icon={Bot}
          value={subscription && !subscription.unlimited ? subscription.credits_remaining : null}
          format={nf} href="/settings?tab=subscription"
          sub={subscription
            ? subscription.unlimited ? 'ללא הגבלה' : `מתוך ${nf(subscription.monthly_credits)} החודש`
            : undefined}
        />
      </div>

      {/* Headline — commissions for the CURRENT month, clicks/posts by month */}
      <OverviewPanel />

      {/* The last 30 days, one measure per chart (they live on different scales). */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
        <DailyChart
          title="קליקים" days={L?.days ?? []} values={L?.daily.clicks ?? []} color={colors.clicks} colors={colors}
          format={nf} total={L ? nf(L.daily.clicks.reduce((a, b) => a + b, 0)) : '—'}
        />
        <DailyChart
          title="פוסטים שיצאו" days={L?.days ?? []} values={L?.daily.posts ?? []} color={colors.posts} colors={colors}
          format={nf} total={L ? nf(L.daily.posts.reduce((a, b) => a + b, 0)) : '—'}
        />
        <DailyChart
          title="עמלות ($)" days={L?.commission_days ?? L?.days ?? []} values={L?.daily.commissions_usd ?? []} color={colors.commissions} colors={colors}
          format={(v) => `$${Math.round(v)}`} total={L ? usd(L.daily.commissions_usd.reduce((a, b) => a + b, 0)) : '—'}
        />
      </div>

      {/* AI token usage — daily consumption + monthly quota gauge */}
      <AiUsagePanel />

      {/* Scale-only: ClickLead campaign spend vs. group commissions (hides itself otherwise) */}
      <ClickleadRoiPanel />

      {/* Main layout: recent posts + mini earnings */}
      <div className="flex flex-col lg:flex-row gap-5">
        {/* Recent posts */}
        <div className="flex-1 card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="section-title">פוסטים אחרונים</h2>
            <Link href="/posts" className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
              הכל
            </Link>
          </div>

          {recentPosts.length === 0 && !isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 text-white/25">
              <FileText size={32} className="mb-3" />
              <p className="text-sm">אין פוסטים עדיין</p>
              <p className="text-xs mt-1">הגדר טייס אוטומטי ראשון כדי להתחיל</p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentPosts.map((post) => (
                <div key={post.id} className="flex items-center gap-3 p-3 rounded-lg hover:bg-white/3 transition-colors">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0
                    ${post.status === 'sent' ? 'bg-emerald-400' :
                      post.status === 'scheduled' ? 'bg-blue-400' :
                      post.status === 'failed' ? 'bg-red-400' : 'bg-amber-400'}`}
                  />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={post.product_image} alt="" className="w-9 h-9 rounded-lg object-cover bg-white/5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white/70 truncate">{post.product_title}</p>
                    <p className="text-2xs text-white/30 mt-0.5">
                      {post.campaign_name && `${post.campaign_name} · `}
                      {post.sent_at
                        ? new Date(post.sent_at).toLocaleString('he-IL', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                        : post.status === 'scheduled' ? `מתוזמן` : 'ממתין'}
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-white/50 flex-shrink-0">₪{post.price_ils?.toLocaleString('he-IL')}</span>
                  {post.status === 'failed' && (
                    <span title={post.error_message ?? undefined}><AlertCircle size={13} className="text-red-400 flex-shrink-0" /></span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Earnings mini panel */}
        <div className="w-full lg:w-72 shrink-0 space-y-3">
          <NowPanel live={L} />

          <div className="card p-5">
            <h2 className="section-title mb-4">הכנסות החודש</h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/40">משוער</span>
                <span className="text-sm font-semibold text-ink">₪{(earnings?.total_estimated ?? 0).toFixed(2)}</span>
              </div>
              <hr className="divider" />
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/40">מוסדר</span>
                <span className="text-sm font-semibold text-ink">₪{(earnings?.total_settled ?? 0).toFixed(2)}</span>
              </div>
              <hr className="divider" />
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/60 font-medium">סה״כ</span>
                <span className="text-base font-bold text-white">₪{totalEarnings.toFixed(2)}</span>
              </div>
            </div>
            <Link href="/reports" className="flex items-center justify-center gap-1.5 mt-4 text-xs text-blue-400 hover:text-blue-300 transition-colors">
              צפה בדוחות המלאים <ChevronLeft size={12} />
            </Link>
          </div>

          {/* Quick actions */}
          <div className="card p-4">
            <p className="section-label mb-3">פעולות מהירות</p>
            <div className="space-y-1.5">
              <Link href="/quick-post" className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/5 text-xs text-white/60 hover:text-white/90 transition-all">
                <Zap size={12} className="text-blue-400" /> פוסט מהיר
              </Link>
              <Link href="/campaigns/new" className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/5 text-xs text-white/60 hover:text-white/90 transition-all">
                <Megaphone size={12} className="text-violet-400" /> טייס אוטומטי חדש
              </Link>
              <Link href="/groups" className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/5 text-xs text-white/60 hover:text-white/90 transition-all">
                <Users size={12} className="text-cyan-400" /> ניהול ערוצים
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
