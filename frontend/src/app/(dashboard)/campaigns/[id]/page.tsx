'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowRight, Play, Pause, Zap, Loader2, AlertCircle, CheckCircle2, Clock, Pencil
} from 'lucide-react';
import { campaignsApi } from '@/lib/api-client';
import type { Campaign, Post } from '@/types';

const STATUS_LABEL: Record<Campaign['status'], string> = {
  active: 'פעיל', paused: 'מושהה', draft: 'טיוטה', error: 'שגיאה',
};

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [c, p] = await Promise.all([
          campaignsApi.get(id),
          campaignsApi.posts(id, { limit: 20 }),
        ]);
        setCampaign(c);
        setPosts(p.data);
      } catch {
        router.push('/campaigns');
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [id, router]);

  const handleToggle = async () => {
    if (!campaign) return;
    const updated = campaign.status === 'active'
      ? await campaignsApi.pause(id)
      : await campaignsApi.resume(id);
    setCampaign(updated);
  };

  /**
   * Reports what the run actually produced. Posts are QUEUED, not published on the spot —
   * they go out through the auto-send schedule (one per interval, inside the send window),
   * which is what "linked to post scheduling" means. It used to print "queued — posts will
   * go out shortly" unconditionally, even when the run failed instantly.
   */
  const handleRunNow = async () => {
    setIsRunning(true);
    setRunResult(null);
    try {
      const r = await campaignsApi.runNow(id);
      const via = r.searched !== r.keyword ? ` (חיפוש: "${r.searched}")` : '';
      const failed = r.failed ? ` · ${r.failed} נכשלו` : '';
      setRunResult(`${r.queued} פוסטים נוצרו עבור "${r.keyword}"${via}${failed} — יתפרסמו לפי תדירות הטייס האוטומטי`);
      // The run just queued posts and bumped posts_count — refetch instead of guessing.
      const [c, p] = await Promise.all([campaignsApi.get(id), campaignsApi.posts(id, { limit: 20 })]);
      setCampaign(c);
      setPosts(p.data);
    } catch (e: any) {
      setRunResult(`שגיאה: ${e?.response?.data?.message || 'ההרצה נכשלה'}`);
    } finally {
      setIsRunning(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 size={24} className="animate-spin text-blue-400" />
      </div>
    );
  }

  if (!campaign) return null;

  return (
    <div>
      {/* Back */}
      <button
        onClick={() => router.push('/campaigns')}
        className="flex items-center gap-2 text-white/40 hover:text-white text-sm mb-6 transition-colors"
      >
        <ArrowRight size={14} />
        הטייס האוטומטי
      </button>

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-white">{campaign.name}</h1>
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full
              ${campaign.status === 'active' ? 'bg-emerald-500/15 text-emerald-400' :
                campaign.status === 'paused' ? 'bg-amber-500/15 text-amber-400' :
                'bg-white/5 text-white/40'}`}
            >
              {STATUS_LABEL[campaign.status]}
            </span>
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full border
              ${campaign.source === 'flylink'
                ? 'bg-violet-500/10 text-violet-300 border-violet-500/30'
                : 'bg-blue-500/10 text-blue-300 border-blue-500/30'}`}
            >
              {campaign.source === 'flylink' ? 'FLYLINK' : 'AliExpress'}
            </span>
          </div>
          <p className="text-sm text-white/40">
            {campaign.posts_count} פוסטים · {campaign.posts_per_run} פוסטים בהרצה
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push(`/campaigns/${id}/edit`)}
            className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-white/60 text-sm rounded-xl transition-all"
          >
            <Pencil size={13} />
            ערוך
          </button>

          <button
            onClick={handleToggle}
            className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-white/60 text-sm rounded-xl transition-all"
          >
            {campaign.status === 'active' ? <Pause size={13} /> : <Play size={13} />}
            {campaign.status === 'active' ? 'השהה' : 'הפעל'}
          </button>

          <button
            onClick={handleRunNow}
            disabled={isRunning || campaign.status !== 'active'}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-all"
          >
            {isRunning ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
            {isRunning ? 'מריץ...' : 'הרץ עכשיו'}
          </button>
        </div>
      </div>

      {/* Run result */}
      {runResult && (
        <div className={`flex items-center gap-2 p-4 rounded-xl mb-6 text-sm
          ${runResult.includes('שגיאה') ? 'bg-red-500/10 border border-red-500/20 text-red-400' : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'}`}
        >
          {runResult.includes('שגיאה') ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}
          {runResult}
        </div>
      )}

      {/* Info cards — keyword/filter cards are AliExpress-specific; FLYLINK shows its
          target-group count and its rotation source instead. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {(campaign.source === 'flylink'
          ? [
              { label: 'מקור', value: 'סבב קטלוג FLYLINK' },
              { label: 'קבוצות יעד', value: `${campaign.target_channels?.length ?? 0} קבוצות` },
            ]
          : [
              { label: 'מילות מפתח', value: campaign.keywords.join(', ') || '—' },
              { label: 'הנחה מינ׳', value: campaign.min_discount ? `${campaign.min_discount}%` : '—' },
              { label: 'דירוג מינ׳', value: campaign.min_rating ? `${campaign.min_rating}★ ומעלה` : 'כל דירוג' },
            ]
        ).concat([
          {
            label: 'הרצה הבאה',
            value: campaign.next_run_at
              ? new Date(campaign.next_run_at).toLocaleString('he-IL', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
              : '—',
          },
          { label: 'פוסטים בהרצה', value: `${campaign.posts_per_run}` },
        ]).map(({ label, value }) => (
          <div key={label} className="bg-surface-secondary border border-edge rounded-xl p-4">
            <p className="text-2xs text-white/30 mb-1">{label}</p>
            <p className="text-xs text-white/70 truncate">{value}</p>
          </div>
        ))}
      </div>

      {/* Posts */}
      <div className="bg-surface-secondary border border-edge rounded-xl p-5">
        <h2 className="text-sm font-semibold text-white mb-4">פוסטים אחרונים</h2>

        {posts.length === 0 && (
          <div className="flex flex-col items-center py-10 text-white/25">
            <Clock size={28} className="mb-3" />
            <p className="text-sm">הטייס האוטומטי טרם שלח פוסטים</p>
          </div>
        )}

        <div className="space-y-2">
          {posts.map((post) => (
            <div key={post.id} className="flex items-center gap-4 p-3 rounded-lg hover:bg-white/3 transition-colors">
              <div className={`w-2 h-2 rounded-full flex-shrink-0
                ${post.status === 'sent' ? 'bg-emerald-400' :
                  post.status === 'failed' ? 'bg-red-400' : 'bg-amber-400'}`}
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={post.product_image} alt="" className="w-10 h-10 rounded-lg object-cover bg-white/5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-white/70 truncate">{post.product_title}</p>
                <p className="text-2xs text-white/30 mt-0.5">
                  {post.sent_at
                    ? new Date(post.sent_at).toLocaleString('he-IL', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                    : 'ממתין'}
                </p>
              </div>
              <span className="text-xs font-semibold text-white/60">₪{post.price_ils.toLocaleString('he-IL')}</span>
              {post.status === 'failed' && (
                <span title={post.error_message ?? undefined}><AlertCircle size={14} className="text-red-400 flex-shrink-0" /></span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
