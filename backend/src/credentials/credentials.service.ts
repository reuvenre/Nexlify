import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { IsNull, Not, Repository } from 'typeorm';
import { MailService } from '../mail/mail.service';
import { CredentialSet } from './credential-set.entity';
import { Channel } from '../channels/channel.entity';
import {
  daysUntil, resolveMetaTokenExpiry, tokenNeedsWarning, verifyFacebookPage,
} from '../common/meta-token';
import { CredentialSetDto } from './dto/credential-set.dto';
import { encrypt, decrypt, mask } from '../common/crypto';
import { verifyState } from '../pinterest/pinterest-oauth';
import axios from 'axios';

/** Facebook Graph API version — kept current & in one place (v19 is deprecated). */
export const GRAPH_VERSION = 'v21.0';

export interface DecryptedCredentials {
  /** Owner of these credentials — lets downstream services (AI, publishing)
   *  attribute usage/credits without changing every call signature. */
  user_id?: string;
  aliexpress_app_key?: string;
  aliexpress_app_secret?: string;
  aliexpress_tracking_id?: string;
  telegram_bot_token?: string;
  telegram_channel_id?: string;
  openai_api_key?: string;
  openai_model?: string;
  // Multi-provider AI
  ai_provider?: string;
  anthropic_api_key?: string;
  anthropic_model?: string;
  gemini_api_key?: string;
  gemini_model?: string;
  ai_monthly_token_budget?: number | null;
  // Facebook / Meta
  facebook_page_id?: string;
  facebook_page_token?: string;
  meta_ad_account_id?: string;
  instagram_business_id?: string;
  publish_telegram?: boolean;
  publish_facebook?: boolean;
  publish_instagram?: boolean;
  // Pinterest (Pins carry a real clickable destination link)
  pinterest_access_token?: string;
  pinterest_board_id?: string;
  pinterest_app_id?: string;
  pinterest_app_secret?: string;
  pinterest_refresh_token?: string;
  pinterest_token_expires_at?: Date | null;
  /** Space-separated scopes Pinterest granted; empty when the connection predates recording. */
  pinterest_scopes?: string;
  /** Last Trial-tier pin refusal — while fresh, the global Pinterest fan-out stands down. */
  pinterest_tier_blocked_at?: Date | null;
  publish_pinterest?: boolean;
  // WhatsApp (official Cloud API or Green API — the latter can post to groups)
  whatsapp_phone_number_id?: string;
  whatsapp_access_token?: string;
  whatsapp_provider?: string;
  green_api_url?: string;
  green_api_instance_id?: string;
  green_api_token?: string;
  whatsapp_group_id?: string;
  publish_whatsapp?: boolean;
  make_webhook_url?: string;
  publish_via_make?: boolean;
  image_enhance_enabled?: boolean;
  image_enhance_mode?: string;
  /** Publish the product's video instead of the image when one exists (TG+WA only). */
  prefer_product_video?: boolean;
  /** Min minutes between Facebook posts per page (0 = every post). Paces FB independently
   *  of Telegram so high-frequency posting doesn't trip Facebook's spam block. */
  facebook_min_interval_minutes?: number;
  // Discovery
  apify_api_token?: string;
  // Auto-boost
  boost_enabled?: boolean;
  boost_roas_threshold?: number;
  boost_daily_budget?: number;
  boost_hard_limit_usd?: number;
  boost_min_revenue_usd?: number;
  boost_target_countries?: string;
  default_body_template_id?: string;
  default_footer_template_id?: string;
  price_markup_pct?: number;
  price_shipping_buffer_ils?: number;
  price_rounding_mode?: string;
  currency_pair?: string;
  schedule_enabled?: boolean;
  schedule_start_hour?: number;
  schedule_end_hour?: number;
  schedule_interval_minutes?: number;
  seasonal_enabled?: boolean;
  recycle_winners_enabled?: boolean;
  optimizer_enabled?: boolean;
  recycle_min_clicks?: number;
  recovery_enabled?: boolean;
  recovery_min_orders?: number;
  recovery_window_days?: number;
  recovery_posts_per_day?: number;
  recovery_campaign_ids?: string[];
  schedule_last_sent_at?: Date;
}

@Injectable()
export class CredentialsService {
  private readonly logger = new Logger(CredentialsService.name);

  constructor(
    @InjectRepository(CredentialSet)
    private readonly repo: Repository<CredentialSet>,
    // The repo, not ChannelsService: that service already depends on THIS one, and the
    // scan below needs nothing but rows.
    @InjectRepository(Channel)
    private readonly channels: Repository<Channel>,
    @Optional() private readonly mail?: MailService,
  ) {}

  /** See meta-token.ts — shared with the per-GROUP tokens, which ask the same question. */
  private resolveTokenExpiry(token: string): Promise<Date | null> {
    return resolveMetaTokenExpiry(token);
  }

  /** Facebook token expiry for the Settings countdown badge + dashboard banner. */
  async getTokenStatus(userId: string): Promise<{ has_token: boolean; expires_at: string | null; days_left: number | null }> {
    const cred = await this.repo.findOne({ where: { user_id: userId } });
    if (!cred?.facebook_page_token_enc) return { has_token: false, expires_at: null, days_left: null };
    let exp = cred.facebook_token_expires_at;
    if (!exp) {
      // Tokens saved before expiry tracking existed — backfill lazily on first read so
      // existing users get the countdown without re-saving their token.
      try {
        exp = await this.resolveTokenExpiry(decrypt(cred.facebook_page_token_enc));
        if (exp) await this.repo.update(cred.id, { facebook_token_expires_at: exp });
      } catch { exp = null; }
    }
    if (!exp) return { has_token: true, expires_at: null, days_left: null };
    const daysLeft = Math.floor((exp.getTime() - Date.now()) / 86_400_000);
    return { has_token: true, expires_at: exp.toISOString(), days_left: daysLeft };
  }

  /**
   * Daily 05:30 UTC (morning IL): email owners whose Facebook Page token dies within
   * 7 days (or already died). Meta tokens expire silently and take Instagram/Facebook
   * publishing down with them — this is the heads-up. Re-mails at most every 3 days
   * until a fresh token is saved (saving resets facebook_token_notified_at).
   */
  @Cron('0 30 5 * * *')
  async warnExpiringFacebookTokens(): Promise<void> {
    if (!this.mail) return;
    const soon = new Date(Date.now() + 7 * 86_400_000);
    const renotifyBefore = new Date(Date.now() - 3 * 86_400_000);
    let creds: CredentialSet[] = [];
    try {
      creds = await this.repo.find({
        where: { facebook_page_token_enc: Not(IsNull()) },
        relations: ['user'],
      });
    } catch (err: any) {
      this.logger.error(`token-expiry scan failed: ${err.message}`);
      return;
    }

    for (const cred of creds) {
      const exp = cred.facebook_token_expires_at;
      if (!exp || exp > soon) continue;                                         // healthy or unknown
      if (cred.facebook_token_notified_at && cred.facebook_token_notified_at > renotifyBefore) continue; // already warned recently
      const email = cred.user?.email;
      if (!email) continue;

      const daysLeft = Math.floor((exp.getTime() - Date.now()) / 86_400_000);
      const expired = daysLeft < 0;
      const subject = expired
        ? '🔴 Nexlify — טוקן הפייסבוק פג! הפרסום לאינסטגרם ופייסבוק מושבת'
        : `⚠️ Nexlify — טוקן הפייסבוק יפוג בעוד ${daysLeft} ימים`;
      const html = `
        <div dir="rtl" style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#0f1117;color:#e5e7eb;border-radius:12px">
          <h2 style="margin:0 0 12px">${expired ? 'טוקן הפייסבוק שלך פג תוקף' : 'טוקן הפייסבוק שלך עומד לפוג'}</h2>
          <p style="line-height:1.7;color:#cbd5e1">
            ${expired
              ? 'ה-Page Access Token של פייסבוק פג — פרסומים לאינסטגרם ולפייסבוק נכשלים כרגע ("Session has expired").'
              : `ה-Page Access Token של פייסבוק יפוג בתאריך <b>${exp.toLocaleDateString('he-IL')}</b>. כשהוא יפוג, פרסומים לאינסטגרם ולפייסבוק יתחילו להיכשל.`}
          </p>
          <p style="line-height:1.7;color:#cbd5e1">
            לחידוש: Graph API Explorer ← Generate Access Token ← בחר את הדף ← Access Token Tool ← <b>Extend Access Token</b> ←
            הדבק את הטוקן המוארך ב-Nexlify: הגדרות ← אינטגרציות ← פייסבוק ← שמור.
          </p>
          <p style="color:#64748b;font-size:12px;margin-top:20px">נשלח אוטומטית על-ידי מערכת ההתראות של Nexlify.</p>
        </div>`;
      try {
        await this.mail.sendHtml(email, subject, html);
        await this.repo.update(cred.id, { facebook_token_notified_at: new Date() });
        this.logger.log(`token-expiry warning emailed to ${email} (${daysLeft} days left)`);
      } catch (err: any) {
        this.logger.warn(`token-expiry email to ${email} failed: ${err.message}`);
      }
    }

    await this.warnExpiringGroupTokens(renotifyBefore).catch((err) =>
      this.logger.error(`group token-expiry scan failed: ${err?.message}`));
  }

  /**
   * The same warning for a GROUP's own Page token — and it NAMES the group.
   *
   * A channel publishing to its own Facebook page carries its own token, and none of them
   * were watched: one could lapse in silence and take that group's Facebook and Instagram
   * publishing with it, discovered days later via a failed post. Worse, the account-level
   * warning above says only "טוקן הפייסבוק", so even an owner who got an email had no way
   * to tell WHICH token to renew. Every line here says the group's name.
   *
   * Runs from the same daily cron as a second pass rather than its own, so the two cannot
   * drift to different schedules or thresholds.
   */
  private async warnExpiringGroupTokens(renotifyBefore: Date): Promise<void> {
    if (!this.mail) return;
    const channels = await this.channels.find({
      where: { facebook_page_token_enc: Not(IsNull()) },
      relations: ['user'],
    });

    for (const ch of channels) {
      if (!tokenNeedsWarning(ch.facebook_token_expires_at)) continue;   // healthy, or expiry unknown
      if (ch.facebook_token_notified_at && ch.facebook_token_notified_at > renotifyBefore) continue;
      const email = ch.user?.email;
      if (!email) continue;

      const exp = ch.facebook_token_expires_at as Date;
      const daysLeft = daysUntil(exp) ?? 0;
      const expired = daysLeft < 0;
      const subject = expired
        ? `🔴 Nexlify — טוקן הפייסבוק של "${ch.name}" פג! הפרסום לקבוצה הזו מושבת`
        : `⚠️ Nexlify — טוקן הפייסבוק של "${ch.name}" יפוג בעוד ${daysLeft} ימים`;
      const html = `
        <div dir="rtl" style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#0f1117;color:#e5e7eb;border-radius:12px">
          <h2 style="margin:0 0 12px">הטוקן של הקבוצה <span style="color:#fbbf24">${ch.name}</span> ${expired ? 'פג תוקף' : 'עומד לפוג'}</h2>
          <p style="line-height:1.7;color:#cbd5e1">
            לקבוצה הזו הוגדר <b>Page Access Token משלה</b> (היא מפרסמת לדף פייסבוק אחר מהדף הראשי).
            ${expired
              ? 'הטוקן פג — הפרסומים לפייסבוק ולאינסטגרם של הקבוצה הזו נכשלים כרגע. שאר הקבוצות לא מושפעות.'
              : `הוא יפוג בתאריך <b>${exp.toLocaleDateString('he-IL')}</b>, ואז הפרסומים של הקבוצה הזו לפייסבוק ולאינסטגרם יתחילו להיכשל. שאר הקבוצות לא מושפעות.`}
          </p>
          <p style="line-height:1.7;color:#cbd5e1">
            לחידוש: Graph API Explorer ← Generate Access Token ← בחר את <b>הדף של הקבוצה הזו</b> ←
            Access Token Tool ← <b>Extend Access Token</b> ← הדבק ב-Nexlify:
            <b>קבוצות ← ${ch.name} ← Page Access Token ← שמור</b>.
          </p>
          <p style="color:#64748b;font-size:12px;margin-top:20px">נשלח אוטומטית על-ידי מערכת ההתראות של Nexlify.</p>
        </div>`;
      try {
        await this.mail.sendHtml(email, subject, html);
        await this.channels.update(ch.id, { facebook_token_notified_at: new Date() });
        this.logger.log(`group token-expiry warning emailed to ${email} for "${ch.name}" (${daysLeft} days left)`);
      } catch (err: any) {
        this.logger.warn(`group token-expiry email to ${email} failed: ${err.message}`);
      }
    }
  }

  async get(userId: string): Promise<any> {
    const cred = await this.repo.findOne({ where: { user_id: userId } });
    if (!cred) throw new NotFoundException('No credentials saved yet');
    return this.toPublic(cred);
  }

  async upsert(userId: string, dto: CredentialSetDto): Promise<any> {
    let cred = await this.repo.findOne({ where: { user_id: userId } });
    if (!cred) {
      cred = this.repo.create({ user_id: userId });
    }

    // Non-secret fields — only update when a non-empty value is provided
    if (dto.aliexpress_app_key?.trim())      cred.aliexpress_app_key = dto.aliexpress_app_key.trim();
    if (dto.aliexpress_tracking_id?.trim())  cred.aliexpress_tracking_id = dto.aliexpress_tracking_id.trim();
    if (dto.telegram_channel_id?.trim())     cred.telegram_channel_id = dto.telegram_channel_id.trim();
    if (dto.openai_model?.trim())            cred.openai_model = dto.openai_model.trim();
    if (dto.currency_pair?.trim())           cred.currency_pair = dto.currency_pair.trim();

    // Multi-provider AI (non-secret)
    if (dto.ai_provider?.trim())             cred.ai_provider = dto.ai_provider.trim();
    if (dto.anthropic_model?.trim())         cred.anthropic_model = dto.anthropic_model.trim();
    if (dto.gemini_model?.trim())            cred.gemini_model = dto.gemini_model.trim();
    // AI token budget: allow clearing (0 / empty → null = untracked)
    if (dto.ai_monthly_token_budget !== undefined) {
      const b = Number(dto.ai_monthly_token_budget);
      cred.ai_monthly_token_budget = Number.isFinite(b) && b > 0 ? Math.round(b) : null;
    }

    // Facebook / Meta (non-secret)
    if (dto.facebook_page_id?.trim())        cred.facebook_page_id = dto.facebook_page_id.trim();
    if (dto.meta_ad_account_id?.trim()) {
      // Graph API requires the act_ prefix; users naturally paste the bare number
      // from Business Manager — normalize so both forms work.
      const v = dto.meta_ad_account_id.trim();
      cred.meta_ad_account_id = /^\d+$/.test(v) ? `act_${v}` : v;
    }
    if (dto.instagram_business_id?.trim())   cred.instagram_business_id = dto.instagram_business_id.trim();
    if (dto.publish_telegram !== undefined)  cred.publish_telegram = dto.publish_telegram;
    if (dto.publish_facebook !== undefined)  cred.publish_facebook = dto.publish_facebook;
    if (dto.publish_instagram !== undefined) cred.publish_instagram = dto.publish_instagram;
    if (dto.publish_pinterest !== undefined) cred.publish_pinterest = dto.publish_pinterest;
    if (dto.make_webhook_url !== undefined)  cred.make_webhook_url = dto.make_webhook_url.trim() || null;
    if (dto.publish_via_make !== undefined)  cred.publish_via_make = dto.publish_via_make;
    if (dto.image_enhance_enabled !== undefined) cred.image_enhance_enabled = dto.image_enhance_enabled;
    if (dto.prefer_product_video !== undefined) cred.prefer_product_video = dto.prefer_product_video;
    if (dto.image_enhance_mode !== undefined) {
      cred.image_enhance_mode = dto.image_enhance_mode === 'ai' ? 'ai' : 'studio';
    }
    if (dto.facebook_min_interval_minutes !== undefined) {
      cred.facebook_min_interval_minutes = Math.max(0, Math.floor(dto.facebook_min_interval_minutes) || 0);
    }

    // Auto-boost settings
    if (dto.boost_enabled !== undefined)         cred.boost_enabled = dto.boost_enabled;
    if (dto.boost_roas_threshold !== undefined)  cred.boost_roas_threshold = dto.boost_roas_threshold;
    if (dto.boost_daily_budget !== undefined)    cred.boost_daily_budget = dto.boost_daily_budget;
    if (dto.boost_hard_limit_usd !== undefined)  cred.boost_hard_limit_usd = dto.boost_hard_limit_usd;
    if (dto.boost_min_revenue_usd !== undefined) cred.boost_min_revenue_usd = dto.boost_min_revenue_usd;
    if (dto.boost_target_countries?.trim())      cred.boost_target_countries = dto.boost_target_countries.trim();

    // Default templates — allow clearing (empty → null to deselect)
    if (dto.default_body_template_id !== undefined)   cred.default_body_template_id = dto.default_body_template_id || null;
    if (dto.default_footer_template_id !== undefined) cred.default_footer_template_id = dto.default_footer_template_id || null;

    // Pricing converter config
    if (dto.price_markup_pct !== undefined)          cred.price_markup_pct = dto.price_markup_pct;
    if (dto.price_shipping_buffer_ils !== undefined) cred.price_shipping_buffer_ils = dto.price_shipping_buffer_ils;
    if (dto.price_rounding_mode?.trim())             cred.price_rounding_mode = dto.price_rounding_mode.trim();

    // Scheduling queue settings
    if (dto.schedule_enabled !== undefined)  cred.schedule_enabled = dto.schedule_enabled;
    if (dto.schedule_start_hour !== undefined)     cred.schedule_start_hour = dto.schedule_start_hour;
    if (dto.schedule_end_hour !== undefined)       cred.schedule_end_hour = dto.schedule_end_hour;
    if (dto.schedule_interval_minutes !== undefined) cred.schedule_interval_minutes = dto.schedule_interval_minutes;
    if (dto.seasonal_enabled !== undefined) cred.seasonal_enabled = dto.seasonal_enabled;
    if (dto.recycle_winners_enabled !== undefined) cred.recycle_winners_enabled = dto.recycle_winners_enabled;
    if (dto.optimizer_enabled !== undefined) cred.optimizer_enabled = dto.optimizer_enabled;
    if (dto.recycle_min_clicks !== undefined) cred.recycle_min_clicks = Math.max(1, Math.floor(dto.recycle_min_clicks) || 10);
    if (dto.recovery_enabled !== undefined) cred.recovery_enabled = dto.recovery_enabled;
    if (dto.recovery_min_orders !== undefined) cred.recovery_min_orders = Math.max(1, Math.floor(dto.recovery_min_orders) || 5);
    if (dto.recovery_window_days !== undefined) cred.recovery_window_days = Math.max(1, Math.floor(dto.recovery_window_days) || 3);
    if (dto.recovery_posts_per_day !== undefined) cred.recovery_posts_per_day = Math.max(1, Math.min(20, Math.floor(dto.recovery_posts_per_day) || 3));
    if (dto.recovery_campaign_ids !== undefined) {
      const ids = Array.isArray(dto.recovery_campaign_ids)
        ? dto.recovery_campaign_ids.map((x) => String(x)).filter(Boolean)
        : [];
      cred.recovery_campaign_ids = ids.length ? JSON.stringify(ids) : null;
    }

    // Secret fields — only update when a non-empty value is provided
    if (dto.aliexpress_app_secret?.trim()) {
      cred.aliexpress_app_secret_enc = encrypt(dto.aliexpress_app_secret.trim());
    }
    if (dto.telegram_bot_token?.trim()) {
      cred.telegram_bot_token_enc = encrypt(dto.telegram_bot_token.trim());
    }
    if (dto.openai_api_key?.trim()) {
      cred.openai_api_key_enc = encrypt(dto.openai_api_key.trim());
    }
    if (dto.anthropic_api_key?.trim()) {
      cred.anthropic_api_key_enc = encrypt(dto.anthropic_api_key.trim());
    }
    if (dto.gemini_api_key?.trim()) {
      cred.gemini_api_key_enc = encrypt(dto.gemini_api_key.trim());
    }
    if (dto.facebook_page_token?.trim()) {
      const fbToken = dto.facebook_page_token.trim();
      cred.facebook_page_token_enc = encrypt(fbToken);
      // Resolve the token's real expiry from Graph so the renew-reminder cron and the
      // Settings countdown know when it dies. A fresh token also resets the notified
      // marker so the next expiry window emails again.
      cred.facebook_token_expires_at = await this.resolveTokenExpiry(fbToken);
      cred.facebook_token_notified_at = null;
    }
    if (dto.apify_api_token?.trim()) {
      cred.apify_api_token_enc = encrypt(dto.apify_api_token.trim());
    }

    // Scaffolded integrations — non-secret ids (direct) + secret tokens (encrypted).
    if (dto.whatsapp_phone_number_id?.trim()) cred.whatsapp_phone_number_id = dto.whatsapp_phone_number_id.trim();
    if (dto.whatsapp_access_token?.trim())    cred.whatsapp_access_token_enc = encrypt(dto.whatsapp_access_token.trim());
    if (dto.whatsapp_provider?.trim())        cred.whatsapp_provider = dto.whatsapp_provider.trim();
    if (dto.green_api_url?.trim())            cred.green_api_url = dto.green_api_url.trim();
    if (dto.green_api_instance_id?.trim())    cred.green_api_instance_id = dto.green_api_instance_id.trim();
    if (dto.green_api_token?.trim())          cred.green_api_token_enc = encrypt(dto.green_api_token.trim());
    if (dto.whatsapp_group_id?.trim())        cred.whatsapp_group_id = dto.whatsapp_group_id.trim();
    if (dto.publish_whatsapp !== undefined)   cred.publish_whatsapp = dto.publish_whatsapp;
    if (dto.amazon_access_key?.trim())        cred.amazon_access_key = dto.amazon_access_key.trim();
    if (dto.amazon_secret_key?.trim())        cred.amazon_secret_key_enc = encrypt(dto.amazon_secret_key.trim());
    if (dto.amazon_partner_tag?.trim())       cred.amazon_partner_tag = dto.amazon_partner_tag.trim();
    if (dto.pinterest_access_token?.trim())   cred.pinterest_access_token_enc = encrypt(dto.pinterest_access_token.trim());
    if (dto.pinterest_board_id?.trim())       cred.pinterest_board_id = dto.pinterest_board_id.trim();
    if (dto.pinterest_app_id?.trim())         cred.pinterest_app_id = dto.pinterest_app_id.trim();
    if (dto.pinterest_app_secret?.trim())     cred.pinterest_app_secret_enc = encrypt(dto.pinterest_app_secret.trim());

    await this.repo.save(cred);
    return this.toPublic(cred);
  }

  /**
   * The Gemini models THIS user's key can generate with, straight from Google's models
   * endpoint (filtered to generateContent-capable gemini* text models, newest first).
   * Empty list when no key is set or the listing fails — the UI then falls back to its
   * static options.
   */
  async listGeminiModels(userId: string): Promise<{ models: { name: string; displayName: string }[] }> {
    const cred = await this.repo.findOne({ where: { user_id: userId } });
    const key = cred?.gemini_api_key_enc ? decrypt(cred.gemini_api_key_enc) : '';
    if (!key) return { models: [] };
    try {
      const res = await axios.get(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=100`,
        { timeout: 8000 },
      );
      const models = (res.data?.models || [])
        .filter((m: any) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m: any) => ({
          name: String(m.name || '').replace(/^models\//, ''),
          displayName: String(m.displayName || ''),
        }))
        // Text-generation gemini models only — skip embeddings/aqa/imagen and dated
        // preview snapshots (e.g. ...-preview-05-20), which retire without notice.
        .filter((m: any) => /^gemini/i.test(m.name) && !/embedding|aqa|preview-\d{2}/i.test(m.name))
        // Newest family first so the UI's top suggestion is the current generation.
        .sort((a: any, b: any) => b.name.localeCompare(a.name, undefined, { numeric: true }));
      return { models };
    } catch (err: any) {
      this.logger.warn(`listGeminiModels failed: ${err?.message}`);
      return { models: [] };
    }
  }

  async verify(userId: string): Promise<{
    aliexpress: boolean; telegram: boolean; openai: boolean;
    gemini: boolean; anthropic: boolean; facebook: boolean; instagram: boolean; metaAdAccount: boolean; apify: boolean;
    errors: Partial<Record<'telegram' | 'openai' | 'gemini' | 'anthropic' | 'facebook' | 'instagram' | 'metaAdAccount', string>>;
  }> {
    const empty = { aliexpress: false, telegram: false, openai: false, gemini: false, anthropic: false, facebook: false, instagram: false, metaAdAccount: false, apify: false };
    const cred = await this.repo.findOne({ where: { user_id: userId } });
    if (!cred) return { ...empty, errors: {} };

    const results = { ...empty };
    const errors: Partial<Record<'telegram' | 'openai' | 'gemini' | 'anthropic' | 'facebook' | 'instagram' | 'metaAdAccount', string>> = {};
    const apiErrorMessage = (err: any): string =>
      err?.response?.data?.error?.message
      || err?.response?.data?.description
      || err?.response?.data?.error
      || err?.message
      || 'unknown error';

    // Verify Telegram
    try {
      const token = decrypt(cred.telegram_bot_token_enc);
      const res = await axios.get(`https://api.telegram.org/bot${token}/getMe`, { timeout: 5000 });
      results.telegram = res.data?.ok === true;
      if (!results.telegram) errors.telegram = res.data?.description || 'invalid response';
    } catch (err: any) { errors.telegram = apiErrorMessage(err); }

    // Verify OpenAI
    try {
      const key = decrypt(cred.openai_api_key_enc);
      if (key) {
        const res = await axios.get('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
          timeout: 5000,
        });
        results.openai = res.status === 200;
      } else {
        errors.openai = 'לא הוזן מפתח API';
      }
    } catch (err: any) { errors.openai = apiErrorMessage(err); }

    // Verify Gemini — do a REAL generateContent call with the CONFIGURED model, exactly
    // like publishing does. The old check only listed models (models?key=), which passes
    // even when the key/project can't actually generate (model not enabled, billing/quota),
    // giving a false "valid" while every post silently fell back to generic copy.
    try {
      const key = decrypt(cred.gemini_api_key_enc);
      if (key) {
        const model = cred.gemini_model || 'gemini-2.5-flash';
        const res = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          { contents: [{ parts: [{ text: 'ping' }] }], generationConfig: { maxOutputTokens: 8 } },
          { headers: { 'Content-Type': 'application/json' }, timeout: 8000, validateStatus: () => true },
        );
        if (res.status === 200 && !res.data?.error) {
          results.gemini = true;
        } else {
          errors.gemini = res.data?.error?.message || `HTTP ${res.status}`;
        }
      } else {
        errors.gemini = 'לא הוזן מפתח API';
      }
    } catch (err: any) { errors.gemini = apiErrorMessage(err); }

    // Verify Anthropic (per-user key, falling back to the server key)
    try {
      const key = decrypt(cred.anthropic_api_key_enc) || process.env.ANTHROPIC_API_KEY;
      if (key) {
        const res = await axios.get('https://api.anthropic.com/v1/models', {
          headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          timeout: 5000,
        });
        results.anthropic = res.status === 200;
      }
    } catch (err: any) { errors.anthropic = apiErrorMessage(err); }

    // Verify the Facebook page token — readability AND publish capability, because a plain
    // user token can read the page name but cannot POST to /{page}/feed, and a name-only
    // check would give a false "OK". See verifyFacebookPage for why the check does NOT ask
    // for `tasks`: that field is absent for a PAGE token, so the old check failed the exact
    // token it then told the owner to go and produce.
    try {
      const token = decrypt(cred.facebook_page_token_enc);
      if (token && cred.facebook_page_id) {
        const verdict = await verifyFacebookPage(cred.facebook_page_id, token);
        results.facebook = verdict.problem === 'ok';
        if (verdict.problem === 'graph') {
          const msg = verdict.graphError?.message || 'unknown error';
          // #100/#803: object not found or wrong node type (e.g. a personal profile id)
          errors.facebook = /nonexisting|does not exist|Unsupported|cannot be loaded/i.test(msg)
            ? `${msg} — ודא שהמזהה הוא של דף עסקי (Page), לא פרופיל אישי, ושהטוקן מכסה את הדף הזה`
            : msg;
        } else if (verdict.problem === 'user-token') {
          errors.facebook = 'זהו טוקן משתמש (User Token) ולא Page Access Token. ב-Graph API Explorer יש לבחור '
            + 'את הדף עצמו בתפריט "User or Page", ולא את המשתמש.';
        } else if (verdict.problem === 'scopes') {
          errors.facebook = `לטוקן חסרות ההרשאות: ${verdict.missing.join(', ')}. `
            + 'יש להפיק מחדש Page Access Token של אדמין הדף עם ההרשאות האלה.';
        }
      } else if (!token) {
        errors.facebook = 'לא הוזן Page Access Token';
      } else {
        errors.facebook = 'לא הוזן Page ID';
      }
    } catch (err: any) { errors.facebook = apiErrorMessage(err); }

    // Verify Instagram Business account (publishing reuses the Page token + IG business id).
    try {
      const token = decrypt(cred.facebook_page_token_enc);
      if (token && cred.instagram_business_id) {
        const res = await axios.get(
          `https://graph.facebook.com/${GRAPH_VERSION}/${cred.instagram_business_id}?fields=username&access_token=${token}`,
          { timeout: 6000, validateStatus: () => true },
        );
        results.instagram = res.status === 200 && !res.data?.error && !!res.data?.username;
        if (!results.instagram) {
          errors.instagram = res.data?.error?.message
            || 'לא נמצא חשבון אינסטגרם עסקי. ודא שהמזהה הוא Instagram Business Account ID המקושר לדף, ושלטוקן יש instagram_content_publish.';
        }
      } else if (!token) {
        errors.instagram = 'נדרש Page Access Token (בקטע פייסבוק)';
      } else {
        errors.instagram = 'לא הוזן Instagram Business Account ID';
      }
    } catch (err: any) { errors.instagram = apiErrorMessage(err); }

    // Verify Meta Ad Account (used only by the auto-boost feature — separate from the
    // page check since it's a distinct purpose/permission, though it reuses the token).
    try {
      const token = decrypt(cred.facebook_page_token_enc);
      if (token && cred.meta_ad_account_id) {
        // Defensive normalization for rows saved before act_ auto-prefixing.
        const adAccount = cred.meta_ad_account_id.startsWith('act_')
          ? cred.meta_ad_account_id
          : `act_${cred.meta_ad_account_id}`;
        const res = await axios.get(
          `https://graph.facebook.com/${GRAPH_VERSION}/${adAccount}?fields=name,account_status&access_token=${token}`,
          { timeout: 5000 },
        );
        results.metaAdAccount = res.status === 200 && !res.data?.error;
        if (!results.metaAdAccount) errors.metaAdAccount = res.data?.error?.message || 'unknown error';
      } else if (!token) {
        errors.metaAdAccount = 'נדרש Page Access Token (למעלה)';
      } else {
        errors.metaAdAccount = 'לא הוזן Meta Ad Account ID';
      }
    } catch (err: any) { errors.metaAdAccount = apiErrorMessage(err); }

    // Apify: token presence (full validation requires a paid run)
    results.apify = !!decrypt(cred.apify_api_token_enc);

    // AliExpress: just check that keys are set
    results.aliexpress = !!(cred.aliexpress_app_key && cred.aliexpress_tracking_id);

    return { ...results, errors };
  }

  // Return decrypted credentials for internal use
  /**
   * Resolve a signed Pinterest OAuth state to its user, verifying the signature against
   * that user's OWN app secret.
   *
   * The callback is public (Pinterest is the caller and carries no login of ours), so the
   * state is the only proof of who started the flow. The secret is per-user, and the state
   * does not say whose it is — so each candidate row is tried, and only a row whose secret
   * validates the signature wins. Rows without an app secret can't have issued anything.
   */
  async findBySignedPinterestState(
    state: string,
  ): Promise<{ userId: string; appId: string; appSecret: string } | null> {
    if (!state) return null;
    const rows = await this.repo.find({
      where: { pinterest_app_secret_enc: Not(IsNull()) },
      select: ['user_id', 'pinterest_app_id', 'pinterest_app_secret_enc'],
    }).catch(() => [] as CredentialSet[]);
    const now = Date.now();
    for (const row of rows) {
      const secret = decrypt(row.pinterest_app_secret_enc);
      if (!secret) continue;
      const userId = verifyState(state, secret, now);
      if (userId && userId === row.user_id) {
        return { userId, appId: row.pinterest_app_id || '', appSecret: secret };
      }
    }
    return null;
  }

  /** Persist a freshly issued or refreshed Pinterest token pair. */
  async savePinterestTokens(
    userId: string,
    t: { accessToken: string; refreshToken: string | null; expiresInSec: number; scopes?: string | null },
  ): Promise<void> {
    const cred = await this.repo.findOne({ where: { user_id: userId } });
    if (!cred) return;
    // Read BEFORE the refresh token is overwritten: this is what distinguishes the
    // first-ever connect from a reconnect.
    const firstConnect = !cred.pinterest_refresh_token_enc;
    cred.pinterest_access_token_enc = encrypt(t.accessToken);
    if (t.refreshToken) cred.pinterest_refresh_token_enc = encrypt(t.refreshToken);
    // What Pinterest actually granted. Only overwritten when the response says something:
    // a refresh that omits `scope` must not erase what the original grant told us.
    if (t.scopes?.trim()) cred.pinterest_scopes = t.scopes.trim();
    // No expiry from Pinterest → treat it as due now, so the next call refreshes rather
    // than publishing with a token of unknown age.
    cred.pinterest_token_expires_at = t.expiresInSec > 0
      ? new Date(Date.now() + t.expiresInSec * 1000)
      : null;
    // Publishing is what the connection is FOR — leaving the switch off after the FIRST
    // connect is a dead end the owner has to guess their way out of. But only the first:
    // a reconnect is a token refresh, and it must not overwrite a toggle the owner set on
    // purpose — turning the global fan-out back on for an account that deliberately keeps
    // Pinterest to its dedicated campaign is exactly how Hebrew posts end up pinned to an
    // English board.
    if (firstConnect) cred.publish_pinterest = true;
    // A fresh grant deserves a fresh try — the recorded tier block belongs to the old one.
    cred.pinterest_tier_blocked_at = null as any;
    await this.repo.save(cred);
  }

  /** Record a Trial-tier pin refusal — the global Pinterest fan-out stands down while fresh. */
  async markPinterestTierBlocked(userId: string): Promise<void> {
    await this.repo.update({ user_id: userId }, { pinterest_tier_blocked_at: new Date() });
  }

  /** A pin went through — whatever block was recorded is over. */
  async clearPinterestTierBlock(userId: string): Promise<void> {
    await this.repo.update({ user_id: userId }, { pinterest_tier_blocked_at: null as any });
  }

  async getRaw(userId: string): Promise<DecryptedCredentials | null> {
    const cred = await this.repo.findOne({ where: { user_id: userId } });
    if (!cred) return null;
    return {
      user_id: cred.user_id,
      aliexpress_app_key: cred.aliexpress_app_key,
      aliexpress_app_secret: decrypt(cred.aliexpress_app_secret_enc),
      aliexpress_tracking_id: cred.aliexpress_tracking_id,
      telegram_bot_token: decrypt(cred.telegram_bot_token_enc),
      telegram_channel_id: cred.telegram_channel_id,
      openai_api_key: decrypt(cred.openai_api_key_enc),
      openai_model: cred.openai_model,
      ai_provider: cred.ai_provider,
      anthropic_api_key: decrypt(cred.anthropic_api_key_enc) || process.env.ANTHROPIC_API_KEY,
      anthropic_model: cred.anthropic_model,
      gemini_api_key: decrypt(cred.gemini_api_key_enc),
      gemini_model: cred.gemini_model,
      ai_monthly_token_budget: cred.ai_monthly_token_budget ?? null,
      facebook_page_id: cred.facebook_page_id,
      facebook_page_token: decrypt(cred.facebook_page_token_enc),
      meta_ad_account_id: cred.meta_ad_account_id,
      instagram_business_id: cred.instagram_business_id,
      publish_telegram: cred.publish_telegram,
      publish_facebook: cred.publish_facebook,
      publish_instagram: cred.publish_instagram,
      pinterest_access_token: decrypt(cred.pinterest_access_token_enc),
      pinterest_board_id: cred.pinterest_board_id,
      pinterest_app_id: cred.pinterest_app_id,
      pinterest_app_secret: decrypt(cred.pinterest_app_secret_enc),
      pinterest_refresh_token: decrypt(cred.pinterest_refresh_token_enc),
      pinterest_token_expires_at: cred.pinterest_token_expires_at,
      pinterest_scopes: cred.pinterest_scopes || '',
      pinterest_tier_blocked_at: cred.pinterest_tier_blocked_at || null,
      publish_pinterest: cred.publish_pinterest,
      whatsapp_phone_number_id: cred.whatsapp_phone_number_id,
      whatsapp_access_token: decrypt(cred.whatsapp_access_token_enc),
      whatsapp_provider: cred.whatsapp_provider,
      green_api_url: cred.green_api_url,
      green_api_instance_id: cred.green_api_instance_id,
      green_api_token: decrypt(cred.green_api_token_enc),
      whatsapp_group_id: cred.whatsapp_group_id,
      publish_whatsapp: cred.publish_whatsapp,
      make_webhook_url: cred.make_webhook_url,
      publish_via_make: cred.publish_via_make,
      image_enhance_enabled: cred.image_enhance_enabled,
      image_enhance_mode: cred.image_enhance_mode || 'studio',
      prefer_product_video: cred.prefer_product_video,
      facebook_min_interval_minutes: cred.facebook_min_interval_minutes,
      apify_api_token: decrypt(cred.apify_api_token_enc),
      boost_enabled: cred.boost_enabled,
      boost_roas_threshold: cred.boost_roas_threshold,
      boost_daily_budget: cred.boost_daily_budget,
      boost_hard_limit_usd: cred.boost_hard_limit_usd,
      boost_min_revenue_usd: cred.boost_min_revenue_usd,
      boost_target_countries: cred.boost_target_countries,
      default_body_template_id: cred.default_body_template_id,
      default_footer_template_id: cred.default_footer_template_id,
      price_markup_pct: cred.price_markup_pct,
      price_shipping_buffer_ils: cred.price_shipping_buffer_ils,
      price_rounding_mode: cred.price_rounding_mode,
      currency_pair: cred.currency_pair,
      schedule_enabled: cred.schedule_enabled,
      schedule_start_hour: cred.schedule_start_hour,
      schedule_end_hour: cred.schedule_end_hour,
      schedule_interval_minutes: cred.schedule_interval_minutes,
      seasonal_enabled: cred.seasonal_enabled ?? true,
      recycle_winners_enabled: cred.recycle_winners_enabled ?? false,
      optimizer_enabled: cred.optimizer_enabled ?? false,
      recycle_min_clicks: cred.recycle_min_clicks ?? 10,
      recovery_enabled: cred.recovery_enabled ?? false,
      recovery_min_orders: cred.recovery_min_orders ?? 5,
      recovery_window_days: cred.recovery_window_days ?? 3,
      recovery_posts_per_day: cred.recovery_posts_per_day ?? 3,
      recovery_campaign_ids: this.parseCampaignIds(cred.recovery_campaign_ids),
      schedule_last_sent_at: cred.schedule_last_sent_at,
    };
  }

  private parseCampaignIds(raw: string | null | undefined): string[] {
    try {
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed.map((x) => String(x)).filter(Boolean) : [];
    } catch { return []; }
  }

  /** WhatsApp Cloud API credentials (decrypted), or null when not configured. */
  async getWhatsApp(userId: string): Promise<{ phoneNumberId: string; token: string } | null> {
    const cred = await this.repo.findOne({ where: { user_id: userId } });
    const phoneNumberId = cred?.whatsapp_phone_number_id?.trim();
    const token = cred?.whatsapp_access_token_enc ? decrypt(cred.whatsapp_access_token_enc) : '';
    if (!phoneNumberId || !token) return null;
    return { phoneNumberId, token };
  }

  /** Amazon PA-API credentials (secret decrypted), or null when not fully configured. */
  async getAmazon(userId: string): Promise<{ accessKey: string; secretKey: string; partnerTag: string } | null> {
    const cred = await this.repo.findOne({ where: { user_id: userId } });
    const accessKey = cred?.amazon_access_key?.trim();
    const partnerTag = cred?.amazon_partner_tag?.trim();
    const secretKey = cred?.amazon_secret_key_enc ? decrypt(cred.amazon_secret_key_enc) : '';
    if (!accessKey || !secretKey || !partnerTag) return null;
    return { accessKey, secretKey, partnerTag };
  }

  /** The user's default Telegram bot token (decrypted) — used as a broadcast fallback. */
  async getTelegramToken(userId: string): Promise<string | null> {
    const cred = await this.repo.findOne({ where: { user_id: userId } });
    return cred?.telegram_bot_token_enc ? decrypt(cred.telegram_bot_token_enc) : null;
  }

  /** Users with sales-recovery enabled + their thresholds (for the recovery cron).
   *  campaignIds is the opt-in campaign filter — empty = every active campaign. */
  async recoverySettings(): Promise<Array<{ userId: string; minOrders: number; windowDays: number; postsPerDay: number; campaignIds: string[] }>> {
    const rows = await this.repo.find({ where: { recovery_enabled: true } });
    return rows.map((c) => {
      let campaignIds: string[] = [];
      try {
        const parsed = JSON.parse(c.recovery_campaign_ids || '[]');
        if (Array.isArray(parsed)) campaignIds = parsed.map((x) => String(x)).filter(Boolean);
      } catch { /* ignore malformed */ }
      return {
        userId: c.user_id,
        minOrders: c.recovery_min_orders ?? 5,
        windowDays: c.recovery_window_days ?? 3,
        postsPerDay: c.recovery_posts_per_day ?? 3,
        campaignIds,
      };
    });
  }

  /** Returns all credential sets with scheduling enabled (for queue cron) */
  async getAllSchedulingEnabled(): Promise<CredentialSet[]> {
    return this.repo.find({ where: { schedule_enabled: true } });
  }

  /** Returns all credential sets with auto-boost enabled (for the Ads cron) */
  async getAllBoostEnabled(): Promise<CredentialSet[]> {
    return this.repo.find({ where: { boost_enabled: true } });
  }

  /** User ids that have AliExpress affiliate keys configured (for the earnings auto-sync). */
  async listUserIdsWithAliexpress(): Promise<string[]> {
    const rows = await this.repo
      .createQueryBuilder('c')
      .select('c.user_id', 'user_id')
      .where("c.aliexpress_app_key IS NOT NULL AND c.aliexpress_app_key <> ''")
      .andWhere("c.aliexpress_app_secret_enc IS NOT NULL AND c.aliexpress_app_secret_enc <> ''")
      .getRawMany();
    return Array.from(new Set(rows.map((r) => String(r.user_id)).filter(Boolean)));
  }

  /** Users with the learning optimizer ON (for the nightly optimizer cron). */
  async listUserIdsWithOptimizer(): Promise<string[]> {
    const rows = await this.repo.find({ where: { optimizer_enabled: true } });
    return rows.map((c) => c.user_id).filter(Boolean);
  }

  /** The account email of a credential-set owner (for digests). */
  async userEmail(userId: string): Promise<string | null> {
    const cred = await this.repo.findOne({ where: { user_id: userId }, relations: ['user'] });
    return cred?.user?.email || null;
  }

  /**
   * Email + role in one hit. The role matters for anything routed to an OPERATOR channel
   * (the watchdog Telegram chat): that chat belongs to the platform owner, so a customer's
   * report must never be sent there.
   */
  async userContact(userId: string): Promise<{ email: string | null; isAdmin: boolean }> {
    const cred = await this.repo.findOne({ where: { user_id: userId }, relations: ['user'] });
    return { email: cred?.user?.email || null, isAdmin: cred?.user?.role === 'admin' };
  }

  /** Users with winner recycling ON + their click threshold (for the daily recycle cron). */
  async listRecycleEnabled(): Promise<Array<{ user_id: string; min_clicks: number }>> {
    const rows = await this.repo.find({ where: { recycle_winners_enabled: true } });
    return rows.map((c) => ({ user_id: c.user_id, min_clicks: c.recycle_min_clicks ?? 10 }));
  }

  /** Records the timestamp of the last sent queued post */
  async updateLastSent(userId: string, sentAt: Date): Promise<void> {
    await this.repo.update({ user_id: userId }, { schedule_last_sent_at: sentAt });
  }

  private toPublic(cred: CredentialSet) {
    return {
      id: cred.id,
      aliexpress_app_key: cred.aliexpress_app_key || '',
      aliexpress_tracking_id: cred.aliexpress_tracking_id || '',
      // Masked secrets — shown as placeholders, re-enter to update
      aliexpress_app_secret: cred.aliexpress_app_secret_enc ? mask(decrypt(cred.aliexpress_app_secret_enc)) : '',
      telegram_bot_token: cred.telegram_bot_token_enc ? mask(decrypt(cred.telegram_bot_token_enc)) : '',
      telegram_channel_id: cred.telegram_channel_id || '',
      openai_api_key: cred.openai_api_key_enc ? mask(decrypt(cred.openai_api_key_enc)) : '',
      openai_model: cred.openai_model || 'gpt-4o-mini',
      // Multi-provider AI
      ai_provider: cred.ai_provider || 'anthropic',
      anthropic_api_key: cred.anthropic_api_key_enc ? mask(decrypt(cred.anthropic_api_key_enc)) : '',
      anthropic_model: cred.anthropic_model || 'claude-sonnet-4-6',
      gemini_api_key: cred.gemini_api_key_enc ? mask(decrypt(cred.gemini_api_key_enc)) : '',
      gemini_model: cred.gemini_model || 'gemini-2.5-flash',
      ai_monthly_token_budget: cred.ai_monthly_token_budget ?? null,
      // Whether AI generation actually WORKS, which is not the same question as "did the
      // user paste a key here": getRaw() falls back to the server's ANTHROPIC_API_KEY, so
      // the engine can be fully operational while every key field above reads empty. The
      // onboarding checklist asks this, not the key fields — otherwise it told users to
      // complete a step that was already done and could not be dismissed.
      ai_ready: !!(
        cred.anthropic_api_key_enc
        || cred.openai_api_key_enc
        || cred.gemini_api_key_enc
        || process.env.ANTHROPIC_API_KEY
      ),
      // Facebook / Meta
      facebook_page_id: cred.facebook_page_id || '',
      facebook_page_token: cred.facebook_page_token_enc ? mask(decrypt(cred.facebook_page_token_enc)) : '',
      meta_ad_account_id: cred.meta_ad_account_id || '',
      instagram_business_id: cred.instagram_business_id || '',
      publish_telegram: cred.publish_telegram ?? true,
      publish_facebook: cred.publish_facebook ?? false,
      publish_instagram: cred.publish_instagram ?? false,
      publish_pinterest: cred.publish_pinterest ?? false,
      make_webhook_url: cred.make_webhook_url || '',
      publish_via_make: cred.publish_via_make ?? false,
      image_enhance_enabled: cred.image_enhance_enabled ?? false,
      image_enhance_mode: cred.image_enhance_mode || 'studio',
      prefer_product_video: cred.prefer_product_video ?? false,
      facebook_min_interval_minutes: cred.facebook_min_interval_minutes ?? 0,
      // Discovery
      apify_api_token: cred.apify_api_token_enc ? mask(decrypt(cred.apify_api_token_enc)) : '',
      // Scaffolded integrations (ids direct, secrets masked)
      whatsapp_phone_number_id: cred.whatsapp_phone_number_id || '',
      whatsapp_access_token: cred.whatsapp_access_token_enc ? mask(decrypt(cred.whatsapp_access_token_enc)) : '',
      whatsapp_provider: cred.whatsapp_provider || 'green',
      green_api_url: cred.green_api_url || '',
      green_api_instance_id: cred.green_api_instance_id || '',
      green_api_token: cred.green_api_token_enc ? mask(decrypt(cred.green_api_token_enc)) : '',
      whatsapp_group_id: cred.whatsapp_group_id || '',
      publish_whatsapp: cred.publish_whatsapp ?? false,
      amazon_access_key: cred.amazon_access_key || '',
      amazon_secret_key: cred.amazon_secret_key_enc ? mask(decrypt(cred.amazon_secret_key_enc)) : '',
      amazon_partner_tag: cred.amazon_partner_tag || '',
      pinterest_access_token: cred.pinterest_access_token_enc ? mask(decrypt(cred.pinterest_access_token_enc)) : '',
      pinterest_board_id: cred.pinterest_board_id || '',
      pinterest_app_id: cred.pinterest_app_id || '',
      pinterest_app_secret: cred.pinterest_app_secret_enc ? mask(decrypt(cred.pinterest_app_secret_enc)) : '',
      // Whether the OAuth connection is live — the settings screen shows "connected" from
      // this instead of implying a connection from a token field that may hold a dead one.
      pinterest_connected: !!cred.pinterest_refresh_token_enc,
      // The GRANT, so the screen can warn that publishing will be refused before a pin is
      // scheduled — rather than after one fails. Empty = an older connection we have no
      // record for, which the UI must treat as unknown rather than as broken.
      pinterest_scopes: cred.pinterest_scopes || '',
      // Auto-boost
      boost_enabled: cred.boost_enabled ?? false,
      boost_roas_threshold: cred.boost_roas_threshold ?? 2.0,
      boost_daily_budget: cred.boost_daily_budget ?? 50,
      boost_hard_limit_usd: cred.boost_hard_limit_usd ?? 200,
      boost_target_countries: cred.boost_target_countries || 'IL',
      default_body_template_id: cred.default_body_template_id || 'builtin_default',
      default_footer_template_id: cred.default_footer_template_id || null,
      price_markup_pct: cred.price_markup_pct ?? 0,
      price_shipping_buffer_ils: cred.price_shipping_buffer_ils ?? 0,
      price_rounding_mode: cred.price_rounding_mode || 'exact',
      currency_pair: cred.currency_pair || 'USD_ILS',
      schedule_enabled: cred.schedule_enabled ?? false,
      schedule_start_hour: cred.schedule_start_hour ?? 9,
      schedule_end_hour: cred.schedule_end_hour ?? 22,
      schedule_interval_minutes: cred.schedule_interval_minutes ?? 60,
      seasonal_enabled: cred.seasonal_enabled ?? true,
      recycle_winners_enabled: cred.recycle_winners_enabled ?? false,
      optimizer_enabled: cred.optimizer_enabled ?? false,
      recycle_min_clicks: cred.recycle_min_clicks ?? 10,
      recovery_enabled: cred.recovery_enabled ?? false,
      recovery_min_orders: cred.recovery_min_orders ?? 5,
      recovery_window_days: cred.recovery_window_days ?? 3,
      recovery_posts_per_day: cred.recovery_posts_per_day ?? 3,
      recovery_campaign_ids: this.parseCampaignIds(cred.recovery_campaign_ids),
      schedule_last_sent_at: cred.schedule_last_sent_at ?? null,
      created_at: cred.created_at,
      updated_at: cred.updated_at,
    };
  }
}
