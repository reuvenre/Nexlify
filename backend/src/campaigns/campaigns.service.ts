import {
  Injectable, NotFoundException, ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CronTime } from 'cron';
import { Campaign } from './campaign.entity';
import { CampaignDto } from './dto/campaign.dto';
import { SubscriptionService } from '../subscription/subscription.service';
import { ChannelsService } from '../channels/channels.service';
import { CredentialsService } from '../credentials/credentials.service';
import { nextPublishAt } from './next-run';
import { sourceSupportsSeasonal } from '../common/seasonal';
import { auditKeywords, KeywordFlag } from './brand-keywords';

@Injectable()
export class CampaignsService {
  constructor(
    @InjectRepository(Campaign)
    private readonly repo: Repository<Campaign>,
    private readonly subscription: SubscriptionService,
    // Resolve each campaign's real send window (group hours / account hours) so the UI can
    // show when a post will actually LEAVE, not just when the cron ticks next.
    private readonly channels: ChannelsService,
    private readonly credentials: CredentialsService,
  ) {}

  /**
   * When this campaign's next post actually leaves — the next cron fire pushed into the
   * effective send window, resolved with the same precedence the scheduler uses:
   * campaign override → target group's hours → account global → the 9–22 default.
   *
   * `creds` is passed in so a list of campaigns decrypts the account row once, not per row.
   * Best-effort: any failure returns null and the UI falls back to the raw cron time.
   */
  private async computeNextPublishAt(
    c: Campaign, creds: { schedule_start_hour?: number | null; schedule_end_hour?: number | null } | null,
  ): Promise<Date | null> {
    if (c.status !== 'active' || !c.schedule_cron) return null;
    try {
      let group: { startHour: number | null; endHour: number | null } | null = null;
      let targets: string[] = [];
      try { targets = JSON.parse(c.target_channels || '[]'); } catch { targets = []; }
      if (targets.length) {
        group = await this.channels.getScheduleWindow(c.user_id, targets[0]).catch(() => null);
      }
      return nextPublishAt(c.schedule_cron, {
        startHour: c.window_start_hour ?? group?.startHour ?? creds?.schedule_start_hour ?? 9,
        endHour: c.window_end_hour ?? group?.endHour ?? creds?.schedule_end_hour ?? 22,
        tz: c.window_tz || process.env.SCHEDULER_TZ || 'Asia/Jerusalem',
      });
    } catch {
      return null;
    }
  }

  /**
   * Subscription gating at the campaign write path. Throws the standard upgrade
   * message when the campaign uses a feature above the user's tier — the matching
   * runtime paths (scheduler, fan-out) enforce the same map as defense-in-depth.
   */
  private async assertPlanAllows(userId: string, dto: Partial<CampaignDto>): Promise<void> {
    if (dto.source === 'amazon') await this.subscription.requireFeature(userId, 'source_amazon');
    if (dto.source === 'flylink') await this.subscription.requireFeature(userId, 'source_flylink');
    if (dto.use_agents) await this.subscription.requireFeature(userId, 'ai_agents');
    if (dto.window_tz) await this.subscription.requireFeature(userId, 'campaign_window_tz');
    if ((dto.language || '').toLowerCase().startsWith('en')) {
      await this.subscription.requireFeature(userId, 'english_campaigns');
    }
    for (const p of dto.target_platforms || []) {
      const key = `platform_${String(p).toLowerCase()}`;
      if (['platform_facebook', 'platform_instagram', 'platform_pinterest', 'platform_whatsapp'].includes(key)) {
        await this.subscription.requireFeature(userId, key as any);
      }
    }
  }

  /** target_channels / target_platforms are stored as JSON text; expose them as real arrays. */
  private toPublic(c: Campaign) {
    let target_channels: string[] = [];
    try { target_channels = JSON.parse(c.target_channels || '[]'); } catch { target_channels = []; }
    let target_platforms: string[] = [];
    try { target_platforms = JSON.parse(c.target_platforms || '[]'); } catch { target_platforms = []; }
    return { ...c, target_channels, target_platforms };
  }

  /**
   * Sweep EVERY campaign's keywords for brand / counterfeit-magnet terms.
   *
   * Deliberately a report, not a guard: the owner decides. What this removes is the part
   * that can't be done by hand — nobody re-reads forty keywords spread over a dozen
   * campaigns looking for the one `adidas official` that slipped in months ago, and that
   * one is exactly what a Meta counterfeit report lands on. Retired keywords are included
   * with a marker: the optimizer can put them back into rotation.
   */
  async keywordAudit(userId: string) {
    const campaigns = await this.repo.find({
      where: { user_id: userId },
      order: { created_at: 'DESC' },
    });

    let scanned = 0;
    const findings: Array<{
      campaign_id: string; campaign_name: string; status: string; retired: boolean;
    } & KeywordFlag> = [];

    for (const c of campaigns) {
      for (const [list, retired] of [[c.keywords, false], [c.retired_keywords, true]] as const) {
        const keywords = Array.isArray(list) ? list : [];
        scanned += keywords.length;
        for (const flag of auditKeywords(keywords)) {
          findings.push({
            campaign_id: c.id,
            campaign_name: c.name,
            status: c.status,
            retired,
            ...flag,
          });
        }
      }
    }

    // Active campaigns first, then high risk — a flagged keyword in a paused campaign is
    // not publishing anything today.
    const rank = (f: (typeof findings)[number]) =>
      (f.status === 'active' && !f.retired ? 0 : 2) + (f.risk === 'high' ? 0 : 1);
    findings.sort((a, b) => rank(a) - rank(b));

    return {
      campaigns: campaigns.length,
      keywords_scanned: scanned,
      high: findings.filter((f) => f.risk === 'high').length,
      watch: findings.filter((f) => f.risk === 'watch').length,
      findings,
    };
  }

  async list(userId: string, page = 1, limit = 20, status?: string) {
    const qb = this.repo.createQueryBuilder('c')
      .where('c.user_id = :userId', { userId })
      .orderBy('c.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (status) qb.andWhere('c.status = :status', { status });

    const [data, total] = await qb.getManyAndCount();
    // One credentials decrypt for the whole page, then a per-campaign window resolve.
    const creds = await this.credentials.getRaw(userId).catch(() => null);
    const enriched = await Promise.all(data.map(async (c) => ({
      ...this.toPublic(c),
      next_publish_at: await this.computeNextPublishAt(c, creds),
    })));
    return { data: enriched, total, page, limit };
  }

  async get(userId: string, id: string) {
    const campaign = await this.repo.findOne({ where: { id } });
    if (!campaign) throw new NotFoundException('Campaign not found');
    if (campaign.user_id !== userId) throw new ForbiddenException();
    return campaign;
  }

  /** API-facing get: target_channels as an array. Internal callers (runner) use get(). */
  async getPublic(userId: string, id: string) {
    const campaign = await this.get(userId, id);
    const creds = await this.credentials.getRaw(userId).catch(() => null);
    return {
      ...this.toPublic(campaign),
      next_publish_at: await this.computeNextPublishAt(campaign, creds),
    };
  }

  async create(userId: string, dto: CampaignDto) {
    await this.assertPlanAllows(userId, dto);
    // target_channels / target_platforms arrive as arrays but the columns are JSON text.
    const { target_channels, target_platforms, keywords, ...rest } = dto;
    const campaign = this.repo.create({
      ...rest,
      keywords: keywords ?? [],
      target_channels: target_channels?.length ? JSON.stringify(target_channels) : null,
      target_platforms: target_platforms?.length ? JSON.stringify(target_platforms) : null,
      user_id: userId,
      // Campaigns start ACTIVE — the scheduler only runs status='active', and a
      // silent 'draft' default meant every new campaign never ran until the user
      // discovered the resume button ("campaigns don't run automatically").
      // Pausing is an explicit action, not the default.
      status: 'active' as const,
      next_run_at: this.nextRun(dto.schedule_cron),
    });
    this.clearSeasonalWhereItCannotWork(campaign);
    return this.repo.save(campaign);
  }

  /**
   * A source that cannot search cannot use seasonal keywords — so it must not store the flag.
   *
   * The commercial calendar injects SEARCH terms, and only the AliExpress runner searches:
   * FLYLINK rotates a linked catalog (no search API exists) and Amazon walks its own cursor.
   * A stored `true` there is a setting that nothing reads and nothing honours, and it cost
   * a real Tishrei window — the toggle sat on for a FLYLINK campaign while 36 posts went out
   * with no seasonal product among them, and it even fooled the watchdog into raising an
   * alert no action could ever clear.
   *
   * Enforced here rather than only in the form, because hiding a control does not change
   * what a campaign switched over from AliExpress already has stored, and the API is
   * reachable without the form at all.
   */
  private clearSeasonalWhereItCannotWork(campaign: Campaign): void {
    if (!sourceSupportsSeasonal(campaign.source)) campaign.seasonal_keywords = false;
  }

  async update(userId: string, id: string, dto: Partial<CampaignDto>) {
    await this.assertPlanAllows(userId, dto);
    const campaign = await this.get(userId, id);

    // Strip identity / server-managed keys before merging. `Partial<CampaignDto>`
    // reflects as `Object` at runtime, so the global ValidationPipe whitelist does NOT
    // apply here — without this guard a caller could inject id / user_id and overwrite
    // another user's campaign (mass-assignment). target_channels is pulled out too so the
    // array is JSON-serialized rather than assigned raw into the text column.
    const { id: _i, user_id: _u, created_at: _c, updated_at: _up,
            posts_count: _p, last_run_at: _l, next_run_at: _n,
            target_channels, target_platforms, ...safe } = dto as any;
    Object.assign(campaign, safe);
    if (target_channels !== undefined) {
      campaign.target_channels = Array.isArray(target_channels) && target_channels.length
        ? JSON.stringify(target_channels) : null;
    }
    if (target_platforms !== undefined) {
      campaign.target_platforms = Array.isArray(target_platforms) && target_platforms.length
        ? JSON.stringify(target_platforms) : null;
    }
    if (dto.schedule_cron) {
      campaign.next_run_at = this.nextRun(dto.schedule_cron);
    }
    // After the merge, so it sees the source this save is landing on — switching a campaign
    // to FLYLINK clears the flag in the same write that switches it.
    this.clearSeasonalWhereItCannotWork(campaign);
    return this.repo.save(campaign);
  }

  async delete(userId: string, id: string) {
    const campaign = await this.get(userId, id);

    // posts.campaign_id carries a foreign key with no ON DELETE behaviour, so any campaign
    // that ever produced a post could not be deleted at all: the constraint rejected the
    // row, the API answered 500, and the UI looked like the click did nothing.
    //
    // Deleting a campaign means two different things for its posts, and they get opposite
    // treatment. Work that has NOT happened yet (scheduled/queued/pending) is the
    // campaign's future — removing the campaign cancels it, or "deleted" posts would keep
    // publishing to a live channel. Work that HAS happened is the account's history:
    // clicks, revenue attribution and the digest all read it, so those rows survive and
    // simply let go of the campaign (the column is already nullable for manual posts).
    await this.repo.query(
      `DELETE FROM posts WHERE user_id = $1 AND campaign_id = $2
       AND status IN ('scheduled', 'queued', 'pending')`, [userId, id]);
    await this.repo.query(
      `UPDATE posts SET campaign_id = NULL WHERE user_id = $1 AND campaign_id = $2`,
      [userId, id]);
    // The dedup memory exists solely to serve this campaign's rotation — no campaign, no
    // point. Best-effort: an orphaned row here blocks nothing.
    await this.repo.query(
      `DELETE FROM campaign_posted_products WHERE campaign_id = $1`, [id]).catch(() => {});

    await this.repo.remove(campaign);
    return { deleted: true };
  }

  async pause(userId: string, id: string) {
    const campaign = await this.get(userId, id);
    campaign.status = 'paused';
    return this.repo.save(campaign);
  }

  async resume(userId: string, id: string) {
    const campaign = await this.get(userId, id);
    campaign.status = 'active';
    campaign.next_run_at = this.nextRun(campaign.schedule_cron);
    return this.repo.save(campaign);
  }

  async markRun(id: string) {
    const campaign = await this.repo.findOne({ where: { id } });
    if (!campaign) return;
    campaign.last_run_at = new Date();
    campaign.next_run_at = this.nextRun(campaign.schedule_cron);
    await this.repo.save(campaign);
  }

  async incrementPostsCount(id: string) {
    await this.repo.increment({ id }, 'posts_count', 1);
  }

  async findActiveForUser(userId: string) {
    return this.repo.find({ where: { user_id: userId, status: 'active' } });
  }

  async findAllActive() {
    return this.repo.find({ where: { status: 'active' } });
  }

  private nextRun(cron: string): Date {
    try {
      const ct = new CronTime(cron);
      const next = ct.sendAt();
      return next.toJSDate ? next.toJSDate() : (next as any).toDate?.() ?? null;
    } catch {
      return null;
    }
  }
}
