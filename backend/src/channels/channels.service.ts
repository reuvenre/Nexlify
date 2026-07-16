import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import axios from 'axios';
import { Channel } from './channel.entity';
import { CreateChannelDto, UpdateChannelDto } from './dto/channel.dto';
import { encrypt, decrypt, mask, normalizeTelegramChatId } from '../common/crypto';
import { SubscriptionService } from '../subscription/subscription.service';

@Injectable()
export class ChannelsService {
  constructor(
    @InjectRepository(Channel)
    private readonly repo: Repository<Channel>,
    private readonly subscription: SubscriptionService,
  ) {}

  async list(userId: string) {
    const channels = await this.repo.find({
      where: { user_id: userId },
      order: { created_at: 'ASC' },
    });

    // Refresh member counts from Telegram in the background (fire-and-forget)
    this.refreshMemberCounts(channels).catch(() => {});

    return channels.map((c) => this.toPublic(c));
  }

  async create(userId: string, dto: CreateChannelDto) {
    // Plan enforcement: each plan allows a max number of channels/groups.
    const maxGroups = await this.subscription.getMaxGroups(userId);
    if (maxGroups !== null) {
      const count = await this.repo.count({ where: { user_id: userId } });
      if (count >= maxGroups) {
        throw new BadRequestException(
          `הגעת למגבלת ${maxGroups} הקבוצות של התוכנית שלך — שדרג תוכנית בהגדרות ← מנוי כדי להוסיף עוד`,
        );
      }
    }

    const channel = this.repo.create({
      user_id: userId,
      name: dto.name,
      platform: dto.platform || 'telegram',
      channel_id: dto.channel_id,
      description: dto.description,
      body_template_id: dto.body_template_id || null,
      footer_template_id: dto.footer_template_id || null,
      facebook_page_id: dto.facebook_page_id?.trim() || null,
      bot_token_enc: dto.bot_token ? encrypt(dto.bot_token) : null,
    });
    await this.repo.save(channel);
    return this.toPublic(channel);
  }

  async update(userId: string, id: string, dto: UpdateChannelDto) {
    const channel = await this.findOwned(userId, id);
    if (dto.name !== undefined) channel.name = dto.name;
    if (dto.channel_id !== undefined) channel.channel_id = dto.channel_id;
    if (dto.description !== undefined) channel.description = dto.description;
    if (dto.is_active !== undefined) channel.is_active = dto.is_active;
    if (dto.body_template_id !== undefined) channel.body_template_id = dto.body_template_id || null;
    if (dto.footer_template_id !== undefined) channel.footer_template_id = dto.footer_template_id || null;
    if (dto.facebook_page_id !== undefined) channel.facebook_page_id = dto.facebook_page_id?.trim() || null;
    if (dto.bot_token?.trim()) channel.bot_token_enc = encrypt(dto.bot_token.trim());
    // Per-group queue overrides — an explicit null clears the override (back to inherit).
    if (dto.schedule_enabled !== undefined) channel.schedule_enabled = dto.schedule_enabled;
    if (dto.schedule_interval_minutes !== undefined) channel.schedule_interval_minutes = dto.schedule_interval_minutes;
    if (dto.schedule_start_hour !== undefined) channel.schedule_start_hour = dto.schedule_start_hour;
    if (dto.schedule_end_hour !== undefined) channel.schedule_end_hour = dto.schedule_end_hour;
    await this.repo.save(channel);
    return this.toPublic(channel);
  }

  async delete(userId: string, id: string) {
    const channel = await this.findOwned(userId, id);
    await this.repo.remove(channel);
    return { deleted: true };
  }

  async test(userId: string, id: string) {
    const channel = await this.findOwned(userId, id);
    const token = channel.bot_token_enc ? decrypt(channel.bot_token_enc) : null;
    if (!token || !channel.channel_id) {
      return { ok: false, error: 'Bot token or channel ID missing' };
    }
    const chatId = normalizeTelegramChatId(channel.channel_id);
    try {
      const res = await axios.post(
        `https://api.telegram.org/bot${token}/sendMessage`,
        { chat_id: chatId, text: '✅ Nexlify — test connection successful!' },
        { timeout: 10000 },
      );

      // Also refresh member count on successful test
      if (res.data?.ok === true) {
        this.fetchMemberCount(token, chatId)
          .then((count) => {
            if (count !== null) {
              this.repo.update(channel.id, { members_count: count });
            }
          })
          .catch(() => {});
      }

      return { ok: res.data?.ok === true };
    } catch (err: any) {
      return { ok: false, error: err?.response?.data?.description || err.message };
    }
  }

  /** Fetches member count from Telegram's getChatMemberCount API */
  private async fetchMemberCount(token: string, chatId: string): Promise<number | null> {
    try {
      const res = await axios.get(
        `https://api.telegram.org/bot${token}/getChatMemberCount`,
        { params: { chat_id: chatId }, timeout: 8000 },
      );
      if (res.data?.ok && typeof res.data.result === 'number') {
        return res.data.result;
      }
    } catch {
      // Silently ignore — member count is best-effort
    }
    return null;
  }

  /** Refreshes member counts for all channels that have a token + channel_id */
  private async refreshMemberCounts(channels: Channel[]): Promise<void> {
    const eligible = channels.filter((c) => c.bot_token_enc && c.channel_id);
    await Promise.all(
      eligible.map(async (c) => {
        const token = decrypt(c.bot_token_enc);
        const chatId = normalizeTelegramChatId(c.channel_id);
        const count = await this.fetchMemberCount(token, chatId);
        if (count !== null && count !== c.members_count) {
          await this.repo.update(c.id, { members_count: count });
          c.members_count = count; // update in-memory so toPublic() returns the fresh value
        }
      }),
    );
  }

  /**
   * Resolve a saved channel by its Telegram channel_id → the bot token + normalized
   * chat id to actually send with. Each channel can carry its OWN bot token, so a post
   * routed here MUST use that bot (the default bot is usually not a member → "chat not
   * found"). Returns null if the user has no matching channel (caller falls back to the
   * default credentials). `token` is null when the channel has no own token (use default).
   */
  async resolveSendTarget(userId: string, channelId: string): Promise<{ token: string | null; chatId: string } | null> {
    const c = await this.repo.findOne({ where: { user_id: userId, channel_id: channelId } });
    if (!c) return null;
    return {
      token: c.bot_token_enc ? decrypt(c.bot_token_enc) : null,
      chatId: normalizeTelegramChatId(c.channel_id),
    };
  }

  /** The per-channel footer template id (each group has its own join link). Null → use the global default. */
  async getFooterTemplateId(userId: string, channelId: string): Promise<string | null> {
    const c = await this.repo.findOne({ where: { user_id: userId, channel_id: channelId } });
    return c?.footer_template_id || null;
  }

  /** The per-channel body template id (each group can have its own copy style). Null → global default. */
  async getBodyTemplateId(userId: string, channelId: string): Promise<string | null> {
    const c = await this.repo.findOne({ where: { user_id: userId, channel_id: channelId } });
    return c?.body_template_id || null;
  }

  /** The per-channel Facebook Page id (each group has its own page). Null → global default. */
  async getFacebookPageId(userId: string, channelId: string): Promise<string | null> {
    const c = await this.repo.findOne({ where: { user_id: userId, channel_id: channelId } });
    return c?.facebook_page_id || null;
  }

  /** Every group of a user, for the per-group queue cron. */
  async listForSchedule(userId: string): Promise<Channel[]> {
    return this.repo.find({ where: { user_id: userId }, order: { created_at: 'ASC' } });
  }

  /**
   * Stamp the per-group send clock for each of `channelIds`. A post that fanned out to
   * several groups advances ALL of their clocks, so no group gets an extra free slot.
   */
  async markSent(userId: string, channelIds: string[], at: Date): Promise<void> {
    const ids = Array.from(new Set((channelIds || []).filter(Boolean)));
    if (!ids.length) return;
    await this.repo
      .createQueryBuilder()
      .update(Channel)
      .set({ schedule_last_sent_at: at })
      .where('user_id = :userId AND channel_id IN (:...ids)', { userId, ids })
      .execute();
  }

  /**
   * "Start the meter" on enqueue so a freshly-queued post can't fire on the very next
   * scheduler tick. When a group's send clock is stale — never sent, or older than its
   * interval — the queue gate treats a new post as immediately due, which the user reads
   * as "it published instead of going into the queue". Stamping the clock to `now` makes
   * the first queued post wait one full interval; a group mid-drip (recent clock) is left
   * untouched so its cadence isn't pushed back. Per-channel interval falls back to the
   * user's global interval when the channel inherits it.
   */
  async primeScheduleIfStale(userId: string, channelIds: string[], now: Date, fallbackIntervalMin: number): Promise<void> {
    const ids = Array.from(new Set((channelIds || []).filter(Boolean)));
    if (!ids.length) return;
    const chans = await this.repo.find({ where: { user_id: userId, channel_id: In(ids) } });
    const stale = chans.filter((c) => {
      const interval = c.schedule_interval_minutes ?? fallbackIntervalMin;
      const last = c.schedule_last_sent_at ? new Date(c.schedule_last_sent_at).getTime() : 0;
      return !last || (now.getTime() - last) / 60_000 >= interval;
    }).map((c) => c.channel_id);
    if (stale.length) await this.markSent(userId, stale, now);
  }

  /** The saved channel's display name (for multi-group error labels). Null if unknown. */
  async getName(userId: string, channelId: string): Promise<string | null> {
    const c = await this.repo.findOne({ where: { user_id: userId, channel_id: channelId } });
    return c?.name || null;
  }

  /**
   * Broadcast a plain-text announcement to every saved Telegram group. Each group is sent
   * with its OWN bot token (falling back to `fallbackToken` — the user's default bot — when
   * a channel has none). Best-effort per group; returns delivery counts.
   */
  async broadcastText(userId: string, text: string, fallbackToken?: string | null): Promise<{ sent: number; failed: number; total: number }> {
    const channels = await this.repo.find({ where: { user_id: userId } });
    let sent = 0, failed = 0;
    for (const c of channels) {
      const token = (c.bot_token_enc ? decrypt(c.bot_token_enc) : null) || fallbackToken || null;
      const chatId = c.channel_id ? normalizeTelegramChatId(c.channel_id) : null;
      if (!token || !chatId) { failed++; continue; }
      try {
        await axios.post(
          `https://api.telegram.org/bot${token}/sendMessage`,
          { chat_id: chatId, text, disable_web_page_preview: false },
          { timeout: 10000 },
        );
        sent++;
      } catch {
        failed++;
      }
    }
    return { sent, failed, total: channels.length };
  }

  private async findOwned(userId: string, id: string): Promise<Channel> {
    const channel = await this.repo.findOne({ where: { id, user_id: userId } });
    if (!channel) throw new NotFoundException('Channel not found');
    return channel;
  }

  private toPublic(c: Channel) {
    return {
      id: c.id,
      name: c.name,
      platform: c.platform,
      channel_id: c.channel_id || '',
      description: c.description || '',
      is_active: c.is_active,
      has_token: !!c.bot_token_enc,
      bot_token_masked: c.bot_token_enc ? mask(decrypt(c.bot_token_enc)) : null,
      body_template_id: c.body_template_id || null,
      footer_template_id: c.footer_template_id || null,
      facebook_page_id: c.facebook_page_id || '',
      // Per-group queue settings — null means "inherit the global schedule".
      schedule_enabled: c.schedule_enabled ?? null,
      schedule_interval_minutes: c.schedule_interval_minutes ?? null,
      schedule_start_hour: c.schedule_start_hour ?? null,
      schedule_end_hour: c.schedule_end_hour ?? null,
      schedule_last_sent_at: c.schedule_last_sent_at ?? null,
      members_count: c.members_count || 0,
      created_at: c.created_at,
      updated_at: c.updated_at,
    };
  }
}
