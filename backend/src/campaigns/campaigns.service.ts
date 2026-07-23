import {
  Injectable, NotFoundException, ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CronTime } from 'cron';
import { Campaign } from './campaign.entity';
import { CampaignDto } from './dto/campaign.dto';
import { SubscriptionService } from '../subscription/subscription.service';

@Injectable()
export class CampaignsService {
  constructor(
    @InjectRepository(Campaign)
    private readonly repo: Repository<Campaign>,
    private readonly subscription: SubscriptionService,
  ) {}

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

  async list(userId: string, page = 1, limit = 20, status?: string) {
    const qb = this.repo.createQueryBuilder('c')
      .where('c.user_id = :userId', { userId })
      .orderBy('c.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (status) qb.andWhere('c.status = :status', { status });

    const [data, total] = await qb.getManyAndCount();
    return { data: data.map((c) => this.toPublic(c)), total, page, limit };
  }

  async get(userId: string, id: string) {
    const campaign = await this.repo.findOne({ where: { id } });
    if (!campaign) throw new NotFoundException('Campaign not found');
    if (campaign.user_id !== userId) throw new ForbiddenException();
    return campaign;
  }

  /** API-facing get: target_channels as an array. Internal callers (runner) use get(). */
  async getPublic(userId: string, id: string) {
    return this.toPublic(await this.get(userId, id));
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
    return this.repo.save(campaign);
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
    return this.repo.save(campaign);
  }

  async delete(userId: string, id: string) {
    const campaign = await this.get(userId, id);
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
