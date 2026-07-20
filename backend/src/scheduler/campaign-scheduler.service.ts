import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import axios from 'axios';
import { CampaignsService } from '../campaigns/campaigns.service';
import { PostsService } from '../posts/posts.service';
import { CredentialsService } from '../credentials/credentials.service';
import { ChannelsService } from '../channels/channels.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrchestratorAgent } from '../agents/orchestrator.agent';
import { SupplierProductsService } from '../suppliers/supplier-products.service';
import { EarningsService } from '../earnings/earnings.service';

@Injectable()
export class CampaignSchedulerService {
  private readonly logger = new Logger(CampaignSchedulerService.name);
  private running = new Set<string>();
  private ticking = false;
  private sendingScheduled = false;
  private processingQueue = false;
  private syncingSuppliers = false;
  private syncingEarnings = false;

  constructor(
    private readonly campaigns: CampaignsService,
    private readonly posts: PostsService,
    private readonly credentials: CredentialsService,
    private readonly channels: ChannelsService,
    private readonly notifications: NotificationsService,
    @Optional() private readonly orchestrator: OrchestratorAgent,
    @Optional() private readonly supplierProducts: SupplierProductsService,
    @Optional() private readonly earnings: EarningsService,
  ) {}

  /**
   * Every 3 hours — the "live" order-tracking pull: auto-syncs AliExpress affiliate orders
   * (aliexpress.affiliate.order.list) for every user with keys, so the orders/earnings screens
   * stay current without a manual refresh. Offset from the top of the hour to avoid colliding
   * with the supplier-price cron; guarded against overlap.
   */
  @Cron('0 20 */3 * * *')
  async syncEarnings() {
    if (!this.earnings || this.syncingEarnings) return;
    this.syncingEarnings = true;
    try {
      const r = await this.earnings.syncAllUsers();
      if (r.synced || r.updated) {
        this.logger.log(`Earnings auto-sync: ${r.synced} new, ${r.updated} updated across ${r.users} users`);
      }
    } catch (err: any) {
      this.logger.error(`Earnings auto-sync tick failed: ${err.message}`);
    } finally {
      this.syncingEarnings = false;
    }
  }

  /**
   * Runs every 6 hours — refreshes supplier-product prices from Yupoo and checks
   * FLYLINK link liveness (→ in_stock). Small sequential batches per tick to bound
   * RAM on the 512MB host; per-row try/catch so one dead URL never aborts the run.
   */
  @Cron('0 0 */6 * * *')
  async syncSupplierProducts() {
    if (!this.supplierProducts || this.syncingSuppliers) return;
    this.syncingSuppliers = true;
    try {
      const due = await this.supplierProducts.dueForSync(25);
      for (const product of due) {
        try {
          await this.supplierProducts.refreshOne(product);
          await new Promise((r) => setTimeout(r, 800)); // pace Yupoo requests
        } catch (err: any) {
          this.logger.warn(`Supplier product ${product.id} sync failed: ${err.message}`);
        }
      }
      if (due.length) this.logger.log(`Supplier sync: refreshed ${due.length} products`);
    } catch (err: any) {
      this.logger.error(`Supplier sync tick failed: ${err.message}`);
    } finally {
      this.syncingSuppliers = false;
    }
  }

  /**
   * Runs every 10 minutes — self-pings the public health endpoint to keep the host
   * awake. On free hosts (Render) the instance spins down after ~15 min with no inbound
   * HTTP, which silently kills every @Cron above. An outbound request to our own public
   * URL comes back as inbound traffic and resets that idle timer, so the scheduler keeps
   * running as long as the process is up. NOTE: this can't wake an instance that already
   * slept — pair it with an external uptime pinger (e.g. UptimeRobot) as a cold-start backstop.
   */
  @Cron('0 */10 * * * *')
  async keepAlive() {
    const base = process.env.BACKEND_URL;
    if (!base || /localhost|127\.0\.0\.1/.test(base)) return; // no-op in local dev
    try {
      await axios.get(`${base.replace(/\/$/, '')}/health`, { timeout: 8000 });
    } catch (err: any) {
      this.logger.warn(`keep-alive ping failed: ${err.message}`);
    }
  }

  /** Runs every minute — sends posts that have reached their scheduled_at time */
  @Cron(CronExpression.EVERY_MINUTE)
  async sendScheduledPosts() {
    // Sending is sequential and each post can take up to 15s (Telegram timeout),
    // so a tick can outlast the 1-minute interval. Without this guard the next tick
    // would re-fetch posts still in 'scheduled' status and send them twice.
    if (this.sendingScheduled) return;
    this.sendingScheduled = true;
    try {
      const due = await this.posts.findDueScheduledPosts();
      for (const post of due) {
        // Per-post try/catch: one user's failing post (bad token, blocked channel)
        // must not abort the whole batch and starve everyone else's scheduled posts.
        try {
          await this.posts.sendScheduled(post);
        } catch (err: any) {
          this.logger.error(`Scheduled post ${post.id} failed: ${err.message}`);
        }
      }
    } catch (err: any) {
      this.logger.error(`Scheduled posts tick failed: ${err.message}`);
    } finally {
      this.sendingScheduled = false;
    }
  }

  /**
   * Runs every minute — processes the smart scheduling queue.
   *
   * Each GROUP has its own queue and its own interval clock, so one group's backlog can
   * never eat another's send slots. Previously a single user-wide queue + a single
   * `schedule_last_sent_at` meant an interval of 60min produced one post per hour ACROSS
   * ALL groups combined, and any post reset the clock for every group.
   *
   * Per user we now run one bucket per group (settings inherit from the user's global
   * schedule when the group leaves them null), plus a "default" bucket for posts that
   * carry no group (`channel_override IS NULL`), which keeps the original behaviour.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async processQueue() {
    // Guard against overlapping ticks — sending posts can outlast the 1-minute interval.
    if (this.processingQueue) return;
    this.processingQueue = true;

    let credentialSets: any[];
    try {
      credentialSets = await this.credentials.getAllSchedulingEnabled();
    } catch {
      this.processingQueue = false;
      return;
    }

    const now = new Date();
    // The host runs in UTC (Render), but users set their send window in local (Israel)
    // time. Compute the current hour in the configured timezone so a 9–22 window means
    // 9am–10pm for the user, not UTC. Intl handles DST automatically.
    const nowHour = this.hourInZone(now, process.env.SCHEDULER_TZ || 'Asia/Jerusalem');

    /** Window + interval gate shared by every bucket. */
    const due = (startHour: number, endHour: number, interval: number, lastSentAt: Date | null) => {
      if (nowHour < startHour || nowHour >= endHour) return false;
      if (!lastSentAt) return true;
      return (now.getTime() - new Date(lastSentAt).getTime()) / 60_000 >= interval;
    };

    try {
      for (const cred of credentialSets) {
        try {
          const gStart = cred.schedule_start_hour ?? 9;
          const gEnd = cred.schedule_end_hour ?? 22;
          const gInterval = cred.schedule_interval_minutes ?? 60;

          // Chats already sent to in THIS tick. Buckets are per-group, but two buckets can
          // resolve to the SAME Telegram chat — most commonly when the user's default
          // channel is ALSO a saved group. Without this, the group bucket and the default
          // bucket both fired to that chat in one tick → two posts at the same moment.
          const served = new Set<string>();

          // ── One bucket per GROUP (own window/interval/clock; null = inherit global) ──
          const channels = await this.channels.listForSchedule(cred.user_id).catch(() => []);
          for (const ch of channels) {
            if (!ch.channel_id) continue;
            if ((ch.schedule_enabled ?? true) === false) continue; // group opted out
            const startHour = ch.schedule_start_hour ?? gStart;
            const endHour = ch.schedule_end_hour ?? gEnd;
            const interval = ch.schedule_interval_minutes ?? gInterval;
            if (!due(startHour, endHour, interval, ch.schedule_last_sent_at)) continue;

            const res = await this.posts.processNextQueuedPost(cred.user_id, ch.channel_id, served);
            if (res.deferred || !res.sent) continue; // deferred = its chat already got a post this tick
            (res.chats || []).forEach((c) => served.add(c));
            // Advance the clock of EVERY group the post reached (a multi-group post must
            // not hand the other groups a free extra slot), and of this group regardless.
            await this.channels.markSent(cred.user_id, [ch.channel_id, ...(res.targets || [])], now);
            if (res.ok) this.logger.log(`Queue: sent post to group ${ch.name} (user ${cred.user_id})`);
            else this.logger.warn(`Queue: post to group ${ch.name} failed: ${res.error || 'unknown error'}`);
          }

          // ── Default bucket: posts with no group — uses the user's global schedule ──
          if (due(gStart, gEnd, gInterval, cred.schedule_last_sent_at)) {
            const res = await this.posts.processNextQueuedPost(cred.user_id, null, served);
            if (res.sent && !res.deferred) {
              (res.chats || []).forEach((c) => served.add(c));
              await this.credentials.updateLastSent(cred.user_id, now);
              // The default channel may itself be a saved group — advance that group's clock
              // too so its bucket doesn't fire to the same chat on the next tick out of sync.
              await this.channels.markSent(cred.user_id, res.chats || [], now).catch(() => {});
              if (res.ok) this.logger.log(`Queue: sent default-channel post for user ${cred.user_id}`);
              else this.logger.warn(`Queue: default-channel post for user ${cred.user_id} failed: ${res.error || 'unknown error'}`);
            }
          }
        } catch (err: any) {
          this.logger.error(`Queue tick failed for user ${cred.user_id}: ${err.message}`);
        }
      }
    } finally {
      this.processingQueue = false;
    }
  }

  /** Current hour (0-23) in the given IANA timezone, DST-aware. */
  private hourInZone(date: Date, tz: string): number {
    try {
      const h = new Intl.DateTimeFormat('en-US', {
        hour: '2-digit', hour12: false, timeZone: tz,
      }).format(date);
      const n = parseInt(h, 10);
      return n === 24 ? 0 : n; // some environments render midnight as "24"
    } catch {
      return date.getHours(); // invalid tz → fall back to server local
    }
  }

  /** Runs every 15 minutes — marks posts stuck in 'pending' for >30 min as failed */
  @Cron('0 */15 * * * *')
  async cleanupStuckPosts() {
    try {
      await this.posts.resetStuckPendingPosts();
    } catch (err: any) {
      this.logger.error(`Stuck posts cleanup failed: ${err.message}`);
    }
  }

  /** Runs every minute — checks which active campaigns are due */
  @Cron(CronExpression.EVERY_MINUTE)
  async tick() {
    // Overlap guard: campaigns now run sequentially (below), so a busy minute can outlast the
    // tick interval. Without this, the next tick would start alongside this one.
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.runDueCampaigns();
    } finally {
      this.ticking = false;
    }
  }

  private async runDueCampaigns() {
    let active: any[];
    try {
      active = await this.campaigns.findAllActive();
    } catch {
      return;
    }

    const now = new Date();

    for (const campaign of active) {
      if (!campaign.next_run_at) continue;
      if (new Date(campaign.next_run_at) > now) continue;
      if (this.running.has(campaign.id)) continue;

      this.running.add(campaign.id);
      this.logger.log(`Running campaign "${campaign.name}" (${campaign.id}) [agents=${campaign.use_agents}]`);

      // Route through the multi-agent orchestrator ONLY when the campaign opted in
      // (use_agents). Otherwise use the plain campaign runner. Previously this keyed off
      // whether the orchestrator was injected (always true), so every campaign wrongly
      // ran through the AI agents regardless of its use_agents flag.
      const useAgents = campaign.use_agents && this.orchestrator;
      // FLYLINK campaigns rotate the linked supplier catalog instead of keyword-searching
      // AliExpress, so they run through a different service. use_agents only applies to the
      // AliExpress path.
      // Return type is unioned across three runners and the result is unused here
      // (fire-and-forget with .catch/.finally below), so widen to unknown.
      const runOnce = (): Promise<unknown> => {
        if (campaign.source === 'flylink' && this.supplierProducts) {
          return this.supplierProducts.runFlylinkCampaign(campaign, campaign.user_id, { fromScheduler: true });
        }
        if (useAgents) return this.orchestrator.run(campaign, campaign.user_id);
        // fromScheduler: skip runs outside the send window so overnight runs don't pile up.
        return this.posts.runCampaign(campaign, campaign.user_id, { fromScheduler: true });
      };
      // AWAIT each campaign before starting the next. Running them concurrently
      // (fire-and-forget) let two campaigns targeting the SAME group both read nextGroupSlot
      // before either saved its post → both grabbed the same slot → two posts to the group a
      // minute apart. Sequential execution makes the first's scheduled post visible to the
      // second's spacing, so they land one interval apart as intended.
      try {
        await this.campaigns.markRun(campaign.id).then(runOnce);
      } catch (err: any) {
        this.logger.error(`Campaign ${campaign.id} failed: ${err.message}`);
        // A campaign dying silently server-side is invisible to the owner — tell them.
        void this.notifications.notifyCampaignError(campaign.user_id, campaign.name, err.message);
      } finally {
        this.running.delete(campaign.id);
      }
    }
  }
}
