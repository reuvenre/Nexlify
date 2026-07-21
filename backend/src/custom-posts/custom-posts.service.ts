import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CustomPost, CustomPostRepeat } from './custom-post.entity';
import { PostsService } from '../posts/posts.service';

const REPEATS: CustomPostRepeat[] = ['none', 'daily', 'weekly'];

@Injectable()
export class CustomPostsService {
  private readonly logger = new Logger(CustomPostsService.name);
  private dispatching = false;

  constructor(
    @InjectRepository(CustomPost) private readonly repo: Repository<CustomPost>,
    private readonly posts: PostsService,
  ) {}

  private clean(input?: any): { channels: string[]; images: string[] } {
    const channels: string[] = Array.isArray(input?.target_channels)
      ? Array.from(new Set<string>(input.target_channels.filter((c: any) => typeof c === 'string' && c.trim()).map((c: string) => c.trim())))
      : [];
    const images: string[] = Array.isArray(input?.image_urls)
      ? input.image_urls.filter((u: any) => typeof u === 'string' && u.trim()).map((u: string) => u.trim())
      : [];
    return { channels, images };
  }

  list(userId: string) {
    return this.repo.find({ where: { user_id: userId }, order: { send_at: 'ASC' } });
  }

  async create(userId: string, dto: any): Promise<CustomPost> {
    if (!dto?.body?.trim()) throw new BadRequestException('חסר תוכן לפוסט');
    if (!dto?.send_at) throw new BadRequestException('חסר תאריך/שעה לשליחה');
    const { channels, images } = this.clean(dto);
    if (!channels.length) throw new BadRequestException('בחר לפחות קבוצת יעד אחת');
    const repeat: CustomPostRepeat = REPEATS.includes(dto.repeat) ? dto.repeat : 'none';
    const sendAt = new Date(dto.send_at);
    const cp = this.repo.create({
      user_id: userId,
      name: (dto.name || '').trim(),
      body: dto.body,
      image_urls: images,
      target_channels: channels,
      send_at: sendAt,
      repeat,
      enabled: dto.enabled !== false,
      next_send_at: sendAt,
    });
    return this.repo.save(cp);
  }

  async update(userId: string, id: string, dto: any): Promise<CustomPost> {
    const cp = await this.get(userId, id);
    if (dto.name !== undefined) cp.name = (dto.name || '').trim();
    if (dto.body !== undefined) cp.body = dto.body;
    if (dto.repeat !== undefined && REPEATS.includes(dto.repeat)) cp.repeat = dto.repeat;
    if (dto.enabled !== undefined) cp.enabled = dto.enabled === true;
    if (dto.image_urls !== undefined || dto.target_channels !== undefined) {
      const { channels, images } = this.clean({ ...cp, ...dto });
      if (dto.target_channels !== undefined) cp.target_channels = channels;
      if (dto.image_urls !== undefined) cp.image_urls = images;
    }
    if (dto.send_at !== undefined) {
      cp.send_at = new Date(dto.send_at);
      // Re-arm the cursor from the new time (so editing the time reschedules the next send).
      cp.next_send_at = cp.send_at;
    }
    return this.repo.save(cp);
  }

  async get(userId: string, id: string): Promise<CustomPost> {
    const cp = await this.repo.findOne({ where: { id, user_id: userId } });
    if (!cp) throw new NotFoundException('פוסט מתוזמן לא נמצא');
    return cp;
  }

  async remove(userId: string, id: string) {
    await this.repo.remove(await this.get(userId, id));
    return { deleted: true };
  }

  /** Next fire time for a recurring post, or null for a one-off (which then disables). */
  private advance(from: Date, repeat: CustomPostRepeat): Date | null {
    if (repeat === 'daily') return new Date(from.getTime() + 24 * 60 * 60_000);
    if (repeat === 'weekly') return new Date(from.getTime() + 7 * 24 * 60 * 60_000);
    return null;
  }

  /**
   * Every minute: dispatch due custom posts. Each is placed into every target group's NEXT
   * free queue slot (nextGroupSlot at/after now), so it interleaves with the autopilot posts
   * on the same clock instead of colliding. Recurring posts re-arm; one-offs disable.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async dispatchDue() {
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      const now = new Date();
      const due = await this.repo.find({
        where: { enabled: true, next_send_at: LessThanOrEqual(now) },
      });
      for (const cp of due) {
        try {
          const channels = cp.target_channels || [];
          const images = cp.image_urls || [];
          for (const group of channels) {
            // Land in the group's next free slot (spaced by its interval from pending posts),
            // at or after now — so it never lands on top of an autopilot post.
            const { slot } = await this.posts.nextGroupSlot(cp.user_id, group, now);
            await this.posts.createQueuedPost(
              cp.user_id,
              {
                product_id: `custom-${cp.id}`,
                title: cp.name || 'פוסט מתוזמן',
                image_url: images[0] || '',
                affiliate_url: '',
                sale_price: 0, original_price: 0, currency: 'ILS',
                discount_percent: 0, orders_count: 0, rating: 0,
              },
              undefined,          // catalogProductId
              cp.body,            // textOverride — exact content, no AI
              group,              // channelOverride
              images,             // images (gallery)
              undefined,          // collageCells
              undefined,          // channels[] (single group per post)
              { scheduledAt: slot },
            );
          }
          cp.last_sent_at = now;
          cp.sent_count = (cp.sent_count || 0) + 1;
          const nextAt = this.advance(cp.next_send_at || now, cp.repeat);
          cp.next_send_at = nextAt;
          if (!nextAt) cp.enabled = false; // one-off done
          await this.repo.save(cp);
          this.logger.log(`Custom post "${cp.name || cp.id}" dispatched to ${channels.length} group(s)`);
        } catch (err: any) {
          this.logger.error(`Custom post ${cp.id} dispatch failed: ${err.message}`);
        }
      }
    } finally {
      this.dispatching = false;
    }
  }
}
