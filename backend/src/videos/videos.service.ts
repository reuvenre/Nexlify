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
    const error = await this.dispatch(job);
    if (error) {
      await this.jobs.update({ id: job.id }, { status: 'failed', error });
      return { job, error };
    }
    await this.jobs.update({ id: job.id }, { status: 'rendering' });
    return { job };
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
      return status === 401 || status === 403 || status === 404
        ? 'הטוקן של GitHub לא מורשה להפעיל את הרינדור — צריך הרשאת Contents: Read and write על הריפו'
        : `הפעלת הרינדור ב-GitHub נכשלה (${status || err?.message})`;
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
  async acceptResult(id: string, token: string, video: Buffer): Promise<string | null> {
    const job = await this.jobFor(id, token, 'worker_token');
    if (!job || job.status !== 'rendering') return 'unknown job';
    if (!looksLikeMp4(video) || video.length > MAX_VIDEO_BYTES) {
      await this.jobs.update({ id }, { status: 'failed', error: `הרינדור החזיר קובץ לא תקין (${video.length} bytes)` });
      return 'not an mp4';
    }
    await this.jobs.update({ id }, { status: 'ready', video, video_size: video.length, rendered_at: new Date() });
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
      const res = await this.posts.publishReel(job.post_id, url);
      const landed = [res.instagram ? 'אינסטגרם' : '', res.facebook ? 'פייסבוק' : ''].filter(Boolean);
      await this.jobs.update({ id }, {
        status: landed.length ? 'published' : 'failed',
        instagram_media_id: res.instagram || null, facebook_video_id: res.facebook || null,
        published_at: landed.length ? new Date() : null,
        error: res.errors.length ? res.errors.join(' | ').slice(0, 1000) : null,
      });
      await this.notifyOwner(job.user_id, [
        landed.length ? `🎬 Reel פורסם ב${landed.join(' וב')}: «${job.spec?.headline || ''}»` : `🎬 ה-Reel לא פורסם: «${job.spec?.headline || ''}»`,
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
       WHERE status IN ('rendering', 'queued') AND created_at < now() - ($2 || ' minutes')::interval RETURNING *`,
      [`הרינדור לא חזר מ-GitHub תוך ${RENDER_TIMEOUT_MIN} דקות`, String(RENDER_TIMEOUT_MIN)],
    ).then((r: any) => (Array.isArray(r?.[0]) ? r[0] : r)).catch(() => []);
    for (const j of stuck || []) await this.notifyOwner(j.user_id, `🎬 ${j.error}. כדאי לבדוק את הריצה בלשונית Actions של הריפו.`);
    await this.jobs.query(
      `UPDATE video_jobs SET video = NULL WHERE video IS NOT NULL AND status IN ('published', 'failed') AND created_at < now() - interval '3 days'`,
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
