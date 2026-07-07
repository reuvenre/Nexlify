'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Megaphone, FileText, DollarSign, TrendingUp,
  AlertCircle, CheckCircle2, Circle, ChevronLeft,
  Users, Zap, RefreshCw, Bot,
} from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';
import { campaignsApi, postsApi, earningsApi, credentialsApi, channelsApi, subscriptionApi } from '@/lib/api-client';
import type { Post, EarningsSummary, SubscriptionStatus } from '@/types';

// ── Onboarding steps ──────────────────────────────────────────────────────────

interface SetupStep {
  id: string;
  label: string;
  desc: string;
  href: string;
  done: boolean;
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, icon: Icon, accent,
}: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; accent: string;
}) {
  const map: Record<string, string> = {
    blue:   'text-blue-300 bg-gradient-to-br from-blue-500/20 to-blue-500/5 border-blue-500/20',
    violet: 'text-violet-300 bg-gradient-to-br from-violet-500/20 to-violet-500/5 border-violet-500/20',
    green:  'text-emerald-300 bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 border-emerald-500/20',
    amber:  'text-amber-300 bg-gradient-to-br from-amber-500/20 to-amber-500/5 border-amber-500/20',
    cyan:   'text-cyan-300 bg-gradient-to-br from-cyan-500/20 to-cyan-500/5 border-cyan-500/20',
  };
  const cls = map[accent] || map.blue;
  return (
    <div className="card p-5 group transition-all duration-300 hover:-translate-y-0.5 hover:border-edge-hover">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-white/40">{label}</p>
        <span className={`w-7 h-7 rounded-lg border flex items-center justify-center transition-transform duration-300 group-hover:scale-110 ${cls}`}>
          <Icon size={14} />
        </span>
      </div>
      <p className="text-2xl font-bold text-white tracking-tight">{value}</p>
      {sub && <p className="text-xs text-white/30 mt-1">{sub}</p>}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState({ campaigns: 0, activeCampaigns: 0, totalPosts: 0, sentToday: 0, channels: 0 });
  const [recentPosts, setRecentPosts] = useState<Post[]>([]);
  const [earnings, setEarnings] = useState<EarningsSummary | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null);
  const [steps, setSteps] = useState<SetupStep[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const displayName = user?.email?.split('@')[0] || 'משתמש';

  const load = async () => {
    setIsLoading(true);
    try {
      const [camps, posts, earn, creds, channels, sub] = await Promise.all([
        campaignsApi.list({ limit: 100 }),
        postsApi.list({ limit: 5 }),
        earningsApi.summary({ period: '30d' }),
        credentialsApi.get().catch(() => null),
        channelsApi.list().catch(() => []),
        subscriptionApi.status().catch(() => null),
      ]);
      setSubscription(sub);

      const sentPosts = posts.data.filter((p) => {
        const today = new Date().toDateString();
        return p.sent_at && new Date(p.sent_at).toDateString() === today;
      });

      setStats({
        campaigns: camps.total,
        activeCampaigns: camps.data.filter((c) => c.status === 'active').length,
        totalPosts: posts.total,
        sentToday: sentPosts.length,
        channels: channels.length,
      });
      setRecentPosts(posts.data);
      setEarnings(earn);

      const aliOk = !!(creds?.aliexpress_app_key);
      const openaiOk = !!(creds?.openai_api_key);
      const channelOk = channels.length > 0;
      const campaignOk = camps.total > 0;
      const postOk = posts.total > 0;

      setSteps([
        { id: 'ali',      label: 'חבר את AliExpress',     desc: 'הגדר App Key ו-App Secret',     href: '/settings',         done: aliOk },
        { id: 'openai',   label: 'חבר את OpenAI',          desc: 'הוסף מפתח API ליצירת תוכן',     href: '/settings',         done: openaiOk },
        { id: 'channel',  label: 'הוסף ערוץ טלגרם',        desc: 'חבר ערוץ לפרסום אוטומטי',       href: '/groups',           done: channelOk },
        { id: 'campaign', label: 'צור קמפיין',              desc: 'הפעל פרסום אוטומטי של מוצרים', href: '/campaigns/new',    done: campaignOk },
        { id: 'post',     label: 'שלח פוסט ראשון',         desc: 'פרסם מוצר לטלגרם',             href: '/quick-post',       done: postOk },
      ]);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const totalEarnings = earnings ? earnings.total_settled + earnings.total_estimated : 0;
  const completedSteps = steps.filter((s) => s.done).length;
  const allDone = steps.length > 0 && completedSteps === steps.length;
  const nextStep = steps.find((s) => !s.done);

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">שלום, {displayName}! 👋</h1>
          <p className="text-sm text-white/40 mt-1">
            {new Date().toLocaleDateString('he-IL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 text-xs text-white/30 hover:text-white/60 transition-colors mt-1"
        >
          <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
          עדכן
        </button>
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

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
        <StatCard label="קמפיינים"       value={isLoading ? '—' : stats.campaigns}                        sub={`${stats.activeCampaigns} פעילים`} icon={Megaphone}  accent="blue" />
        <StatCard label="סה״כ פוסטים"    value={isLoading ? '—' : stats.totalPosts.toLocaleString()}      sub={`${stats.sentToday} היום`}          icon={FileText}   accent="violet" />
        <StatCard label="ערוצים"         value={isLoading ? '—' : stats.channels}                         sub="ערוצי טלגרם"                         icon={Users}      accent="cyan" />
        <StatCard label="הכנסות (30 יום)" value={isLoading ? '—' : `₪${totalEarnings.toFixed(0)}`}        sub="מוסדר + משוער"                       icon={DollarSign}  accent="green" />
        <StatCard label="עמלה מוסדרת"    value={isLoading ? '—' : `₪${(earnings?.total_settled ?? 0).toFixed(0)}`} sub="30 ימים אחרונים"            icon={TrendingUp}  accent="amber" />
        <Link href="/settings?tab=subscription" className="card p-5 group transition-all duration-300 hover:-translate-y-0.5 hover:border-edge-hover block">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-white/40">קרדיטים ({subscription?.plan_name || '—'})</p>
            <span className="w-7 h-7 rounded-lg border border-violet-500/20 flex items-center justify-center text-violet-300 bg-gradient-to-br from-violet-500/20 to-violet-500/5 transition-transform duration-300 group-hover:scale-110">
              <Bot size={14} />
            </span>
          </div>
          <p className="text-2xl font-bold text-white">
            {isLoading || !subscription ? '—' : subscription.credits_remaining.toLocaleString()}
          </p>
          <div className="mt-2 h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-violet-500 to-blue-500 rounded-full transition-all"
              style={{
                width: subscription && subscription.monthly_credits > 0
                  ? `${Math.min(100, Math.round((subscription.credits_remaining / subscription.monthly_credits) * 100))}%`
                  : '0%',
              }}
            />
          </div>
          <p className="text-xs text-white/30 mt-1">
            {subscription ? `/ ${subscription.monthly_credits.toLocaleString()} החודש` : 'טוען...'}
          </p>
        </Link>
      </div>

      {/* Main layout: recent posts + mini earnings */}
      <div className="flex gap-5">
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
              <p className="text-xs mt-1">צור קמפיין ראשון כדי להתחיל</p>
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
        <div className="w-64 shrink-0 space-y-3">
          <div className="card p-5">
            <h2 className="section-title mb-4">הכנסות החודש</h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/40">משוער</span>
                <span className="text-sm font-semibold text-amber-400">₪{(earnings?.total_estimated ?? 0).toFixed(2)}</span>
              </div>
              <hr className="divider" />
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/40">מוסדר</span>
                <span className="text-sm font-semibold text-emerald-400">₪{(earnings?.total_settled ?? 0).toFixed(2)}</span>
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
                <Megaphone size={12} className="text-violet-400" /> קמפיין חדש
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
