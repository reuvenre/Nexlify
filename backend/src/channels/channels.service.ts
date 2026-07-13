import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
    if (dto.bot_token?.trim()) channel.bot_token_enc = encrypt(dto.bot_token.trim());
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
      members_count: c.members_count || 0,
      created_at: c.created_at,
      updated_at: c.updated_at,
    };
  }
}
