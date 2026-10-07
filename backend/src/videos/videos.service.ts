import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import axios from 'axios';
import { VideoJob } from './video-job.entity';
import { Post } from '../posts/post.entity';
import { PostsService } from '../posts/posts.service';
import { ChannelsService } from '../channels/channels.service';
import { CredentialsService } from '../credentials/credentials.service';
import { buildReelSpec } from './reel-spec';
import { AI_CLIP_MODEL_DEFAULT, DEFAULT_AI_CLIPS_PER_DAY, aiClipRequest, readInteractionVideo } from './ai-clip';

/** Largest MP4 accepted from the renderer — a 12 s 1080×1920 Reel is about 3 MB. */
export const MAX_VIDEO_BYTES = 40 * 1024 * 1024;
/** A render that has not come back in this long is reported failed. */
const RENDER_TIMEOUT_MIN = 40;

/** The repository whose Actions render videos, and a token allowed to dispatch to it. */
function renderTarget(): { repo: string; token: string | null } {
  return {
    repo: (process.env.GITHUB_RENDER_REPO || process.env.GITHUB_WATCHDOG_REPO || 'reuvenre/Nexlify').trim(),
    token: (process.env.GITHUB_RENDER_TOKEN || process.env.GITHUB_WATCHDOG_TOKEN || '').trim() || null,
  };
}

function backendBase(): string {
  return (process.env.BACKEND_URL || '').replace(/\/$/, '');
}

/** Is this an MP4 at all? ISO media files carry 'ftyp' at byte 4. */
export function looksLikeMp4(buf: Buffer): boolean {
  return buf.length > 12 && buf.toString('latin1', 4, 8) === 'ftyp';
}

/**
 * Product Reels: a sent post becomes a 12 s vertical video and goes out to Instagram and
 * Facebook Reels.
 *
 * Rendering needs headless Chrome and FFmpeg, which the free Render instance cannot carry
 * next to every scheduled job, so the backend only describes the video (reel-spec.ts) and a
 * GitHub Actions workflow (.github/workflows/render-video.yml → video-renderer/) renders it
 * and posts the MP4 back. Meta then pulls it from /videos/<id>.mp4.
 *
 * Off unless REELS_ENABLED=1 (the daily pick); /reel in the owner's bot makes one on demand.
 */
@Injectable()
export class VideosService {
  private readonly logger = new Logger(VideosService.name);

  constructor(
    @InjectRepository(VideoJob) private readonly jobs: Repository<VideoJob>,
    @InjectRepository(Post) private readonly postsRepo: Repository<Post>,
    private readonly posts: PostsService,
    private readonly channels: ChannelsService,
    private readonly credentials: CredentialsService,
  ) {}

  /** The post a Reel should be made of now: the most-clicked sent post of the last two days without one. */
  async bestRecentPost(userId?: string): Promise<{ id: string; user_id: string } | null> {
    const rows = await this.postsRepo.query(
      `SELECT p.id, p.user_id FROM posts p
       WHERE p.status = 'sent' AND p.sent_at > now() - interval '48 hours'
         AND ($1::uuid IS NULL OR p.user_id = $1::uuid)
         AND p.product_image IS NOT NULL AND coalesce(p.price_ils, 0) > 0
         AND NOT EXISTS (SELECT 1 FROM video_jobs v WHERE v.post_id = p.id AND v.status <> 'failed')
       ORDER BY coalesce(p.clicks_count, 0) DESC, p.sent_at DESC LIMIT 1`,
      [userId || null],
    ).catch(() => []);
    return rows[0] || null;
  }

  /** Describe the Reel for a sent post and hand it to GitHub Actions. */
  async requestReel(postId: string, origin: 'auto' | 'owner'): Promise<{ job?: VideoJob; error?: string }> {
    const post = await this.postsRepo.findOne({ where: { id: postId } });
    if (!post) return { error: 'הפוסט לא נמצא' };
    const target = post.channel_override || undefined;
    const brand = target ? await this.channels.getName(post.user_id, target).catch(() => null) : null;
    const spec = buildReelSpec(post as any, brand);
    if (!spec) return { error: 'לפוסט חסרים תמונה, מחיר או טקסט — אי אפשר לבנות ממנו סרטון' };
    const job = await this.jobs.save(this.jobs.create({
      user_id: post.user_id, post_id: post.id, origin, spec,
      worker_token: randomBytes(24).toString('hex'), media_token: randomBytes(24).toString('hex'),
    }));
    // No seller video: an AI clip, when switched on and affordable today. It takes minutes,
    // so it runs in the background and dispatches the render itself when done.
    if (!spec.video && await this.aiClipAllowed(post.user_id)) {
      await this.jobs.update({ id: job.id }, { status: 'generating' });
      setImmediate(() => { void this.generateClipThenRender(job.id, post.product_title, spec.images[0]); });
      return { job };
    }
    // 'rendering' BEFORE the dispatch: the runner may ask for the spec as soon as it starts.
    await this.jobs.update({ id: job.id }, { status: 'rendering' });
    const error = await this.dispatch(job);
    if (error) {
      await this.jobs.update({ id: job.id }, { status: 'failed', error });
      return { job, error };
    }
    return { job };
  }

  /** REELS_AI_VIDEO=1, a Gemini key on the account, and under today's cap. */
  private async aiClipAllowed(userId: string): Promise<boolean> {
    if (process.env.REELS_AI_VIDEO !== '1') return false;
    const creds = await this.credentials.getRaw(userId).catch(() => null);
    if (!creds?.gemini_api_key) return false;
    const cap = Number(process.env.REELS_AI_PER_DAY) || DEFAULT_AI_CLIPS_PER_DAY;
    const [{ n }] = await this.jobs.query(
      `SELECT count(*)::int AS n FROM video_jobs
       WHERE user_id = $1 AND created_at > now() - interval '1 day' AND (status = 'generating' OR clip_source = 'ai' OR clip IS NOT NULL)`,
      [userId],
    ).catch(() => [{ n: cap }]);
    return n < cap;
  }

  /**
   * Gemini Omni Flash: the product photo + the unboxing prompt → a vertical clip. Whatever
   * happens, the render is dispatched — a failed clip means a photo Reel, never no Reel.
   */
  private async generateClipThenRender(id: string, title: string | null | undefined, imageUrl: string): Promise<void> {
    const job = await this.jobs.findOne({ where: { id } });
    if (!job) return;
    let note: string | null = null;
    try {
      const creds = await this.credentials.getRaw(job.user_id);
      const img = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 20_000, maxContentLength: 8 * 1024 * 1024 });
      const mime = String(img.headers['content-type'] || 'image/jpeg').split(';')[0];
      const model = (process.env.REELS_AI_MODEL || AI_CLIP_MODEL_DEFAULT).trim();
      const res = await axios.post(
        'https://generativelanguage.googleapis.com/v1beta/interactions',
        aiClipRequest(model, Buffer.from(img.data).toString('base64'), mime, title),
        {
          headers: { 'x-goog-api-key': creds!.gemini_api_key!, 'Content-Type': 'application/json' },
          timeout: 8 * 60_000, maxContentLength: 120 * 1024 * 1024, maxBodyLength: 20 * 1024 * 1024,
        },
      );
      const { video, reason } = readInteractionVideo(res.data);
      if (!video || !looksLikeMp4(video)) throw new Error(reason || 'not an mp4');
      await this.jobs.update({ id }, {
        clip: video,
        spec: { ...job.spec, video: `${backendBase()}/videos/jobs/${id}/clip.mp4?t=${job.worker_token}`, ai: true },
      });
      this.logger.log(`video ${id}: AI clip ${(video.length / 1048576).toFixed(1)} MB`);
    } catch (err: any) {
      const status = err?.response?.status;
      const msg = err?.response?.data?.error?.message || err?.message;
      note = `קליפ ה-AI לא נוצר (${status ? `${status} ` : ''}${String(msg).slice(0, 160)}) — הסרטון ייצא מהתמונות`;
      this.logger.warn(`video ${id}: ${note}`);
    }
    const fresh = await this.jobs.findOne({ where: { id } });
    if (!fresh) return;
    await this.jobs.update({ id }, { status: 'rendering', error: note });
    const error = await this.dispatch(fresh);
    if (error) {
      await this.jobs.update({ id }, { status: 'failed', error });
      await this.notifyOwner(fresh.user_id, `🎬 ${error}`);
    }
  }

  /** The AI clip, for the renderer (worker token). */
  async clipFor(id: string, token: string): Promise<Buffer | null> {
    const job = await this.jobFor(id, token, 'worker_token');
    if (!job || job.status !== 'rendering') return null;
    const row = await this.jobs.createQueryBuilder('j').addSelect('j.clip').where('j.id = :id', { id }).getOne();
    return row?.clip || null;
  }

  /** repository_dispatch → render-video.yml. The URLs carry the job's own worker token. */
  private async dispatch(job: VideoJob): Promise<string | null> {
    const { repo, token } = renderTarget();
    const base = backendBase();
    if (!token) return 'חסר טוקן GitHub (GITHUB_RENDER_TOKEN) — אי אפשר להפעיל את הרינדור';
    if (!base) return 'חסר BACKEND_URL';
    try {
      await axios.post(`https://api.github.com/repos/${repo}/dispatches`, {
        event_type: 'render-video',
        client_payload: {
          job_id: job.id,
          spec_url: `${base}/videos/jobs/${job.id}/spec?t=${job.worker_token}`,
          result_url: `${base}/videos/jobs/${job.id}/result?t=${job.worker_token}`,
        },
      }, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        timeout: 15_000,
      });
      return null;
    } catch (err: any) {
      const status = err?.response?.status;
      this.logger.warn(`video ${job.id}: dispatch failed (${status}): ${err?.response?.data?.message || err?.message}`);
      const which = process.env.GITHUB_RENDER_TOKEN ? 'GITHUB_RENDER_TOKEN' : 'GITHUB_WATCHDOG_TOKEN (אין GITHUB_RENDER_TOKEN)';
      if (status === 401) return `GitHub דחה את הטוקן ${which} — הוא לא תקין או שפג תוקפו (401)`;
      if (status === 403) return `לטוקן ${which} אין הרשאה להפעיל את הרינדור — צריך Contents: Read and write על ${repo} (403)`;
      if (status === 404) return `הטוקן ${which} לא רואה את הריפו ${repo} — צריך לתת לו גישה לריפו הזה (404)`;
      return `הפעלת הרינדור ב-GitHub נכשלה (${status || err?.message})`;
    }
  }

  private async jobFor(id: string, token: string, field: 'worker_token' | 'media_token'): Promise<VideoJob | null> {
    if (!/^[0-9a-f-]{36}$/.test(id) || !/^[0-9a-f]{48}$/.test(String(token || ''))) return null;
    const job = await this.jobs.findOne({ where: { id } }).catch(() => null);
    return job && job[field] === token ? job : null;
  }

  async specFor(id: string, token: string): Promise<any | null> {
    const job = await this.jobFor(id, token, 'worker_token');
    return job && job.status === 'rendering' ? job.spec : null;
  }

  /** The renderer's MP4. Accepted once; publishing starts in the background. */
  async acceptResult(id: string, token: string, video: Buffer, clipSource?: string): Promise<string | null> {
    const job = await this.jobFor(id, token, 'worker_token');
    if (!job || job.status !== 'rendering') return 'unknown job';
    if (!looksLikeMp4(video) || video.length > MAX_VIDEO_BYTES) {
      await this.jobs.update({ id }, { status: 'failed', error: `הרינדור החזיר קובץ לא תקין (${video.length} bytes)` });
      return 'not an mp4';
    }
    const source = ['seller', 'ai', 'none'].includes(String(clipSource)) ? String(clipSource) : null;
    await this.jobs.update({ id }, { status: 'ready', video, video_size: video.length, rendered_at: new Date(), clip_source: source, clip: null });
    setImmediate(() => { void this.publish(id); });
    return null;
  }

  async acceptFailure(id: string, token: string, message: string): Promise<void> {
    const job = await this.jobFor(id, token, 'worker_token');
    if (!job || job.status !== 'rendering') return;
    const error = `הרינדור נכשל: ${String(message || '').slice(0, 300)}`;
    await this.jobs.update({ id }, { status: 'failed', error });
    await this.notifyOwner(job.user_id, `🎬 ${error}`);
  }

  /** The MP4 for Meta's fetcher. */
  async media(id: string, token: string): Promise<Buffer | null> {
    const job = await this.jobFor(id, token, 'media_token');
    if (!job) return null;
    const row = await this.jobs.createQueryBuilder('j').addSelect('j.video').where('j.id = :id', { id }).getOne();
    return row?.video || null;
  }

  /** Hand the finished Reel to Instagram and Facebook, and tell the owner what happened. */
  async publish(id: string): Promise<void> {
    const job = await this.jobs.findOne({ where: { id } });
    if (!job || job.status !== 'ready') return;
    const url = `${backendBase()}/videos/${job.id}.mp4?t=${job.media_token}`;
    try {
      const res = await this.posts.publishReel(job.post_id, url, { aiClip: job.clip_source === 'ai' });
      const landed = [res.instagram ? 'אינסטגרם' : '', res.facebook ? 'פייסבוק' : ''].filter(Boolean);
      await this.jobs.update({ id }, {
        status: landed.length ? 'published' : 'failed',
        instagram_media_id: res.instagram || null, facebook_video_id: res.facebook || null,
        published_at: landed.length ? new Date() : null,
        error: res.errors.length ? res.errors.join(' | ').slice(0, 1000) : null,
      });
      const opened = job.clip_source === 'seller' ? '🎥 עם סרטון המוכר'
        : job.clip_source === 'ai' ? '🤖 עם קליפ AI (מסומן ככזה)' : '📸 מתמונות המוצר';
      await this.notifyOwner(job.user_id, [
        landed.length ? `🎬 Reel פורסם ב${landed.join(' וב')}: «${job.spec?.headline || ''}»` : `🎬 ה-Reel לא פורסם: «${job.spec?.headline || ''}»`,
        opened,
        ...(job.error ? [`ℹ️ ${job.error}`] : []),
        ...res.errors.map((e) => `⚠️ ${e}`),
      ].join('\n'));
    } catch (err: any) {
      await this.jobs.update({ id }, { status: 'failed', error: String(err?.message || err).slice(0, 1000) });
      await this.notifyOwner(job.user_id, `🎬 ה-Reel לא פורסם: ${err?.message || err}`);
    }
  }

  /**
   * Once a day: a Reel of the most-clicked post of the last two days. A proven product is
   * what deserves the video — and a cap keeps GitHub minutes and Meta's limits in check.
   */
  @Cron('0 42 12 * * *', { timeZone: 'Asia/Jerusalem' })
  async dailyReels(): Promise<number> {
    if (process.env.REELS_ENABLED !== '1') return 0;
    const perDay = Math.max(0, Math.min(5, Number(process.env.REELS_PER_DAY) || 1));
    let made = 0;
    for (let i = 0; i < perDay; i++) {
      const best = await this.bestRecentPost();
      if (!best) break;
      const { error } = await this.requestReel(best.id, 'auto');
      if (error) {
        await this.notifyOwner(best.user_id, `🎬 ה-Reel היומי לא נוצר: ${error}`);
        break;
      }
      made++;
    }
    return made;
  }

  /** A render that never came back is failed; a published file is let go after three days. */
  @Cron('0 */30 * * * *')
  async housekeeping(): Promise<void> {
    const stuck: VideoJob[] = await this.jobs.query(
      `UPDATE video_jobs SET status = 'failed', error = $1
       WHERE status IN ('rendering', 'queued', 'generating') AND created_at < now() - ($2 || ' minutes')::interval RETURNING *`,
      [`הרינדור לא חזר מ-GitHub תוך ${RENDER_TIMEOUT_MIN} דקות`, String(RENDER_TIMEOUT_MIN)],
    ).then((r: any) => (Array.isArray(r?.[0]) ? r[0] : r)).catch(() => []);
    for (const j of stuck || []) await this.notifyOwner(j.user_id, `🎬 ${j.error}. כדאי לבדוק את הריצה בלשונית Actions של הריפו.`);
    await this.jobs.query(
      `UPDATE video_jobs SET video = NULL, clip = NULL
       WHERE (video IS NOT NULL OR clip IS NOT NULL) AND status IN ('published', 'failed') AND created_at < now() - interval '3 days'`,
    ).catch(() => {});
  }

  /** A short line to the owner's Telegram chat. Best-effort. */
  private async notifyOwner(userId: string, text: string): Promise<void> {
    const chatId = process.env.WATCHDOG_TELEGRAM_CHAT_ID;
    const token = process.env.WATCHDOG_TELEGRAM_BOT_TOKEN
      || await this.credentials.getTelegramToken(userId).catch(() => null);
    if (!chatId || !token) return;
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, { chat_id: chatId, text }, { timeout: 10_000 })
      .catch((err) => this.logger.warn(`video notify failed: ${err?.message}`));
  }
}
