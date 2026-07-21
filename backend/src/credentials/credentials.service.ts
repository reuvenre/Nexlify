import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CredentialSet } from './credential-set.entity';
import { CredentialSetDto } from './dto/credential-set.dto';
import { encrypt, decrypt, mask } from '../common/crypto';
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
  schedule_last_sent_at?: Date;
}

@Injectable()
export class CredentialsService {
  constructor(
    @InjectRepository(CredentialSet)
    private readonly repo: Repository<CredentialSet>,
  ) {}

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
      cred.facebook_page_token_enc = encrypt(dto.facebook_page_token.trim());
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

    await this.repo.save(cred);
    return this.toPublic(cred);
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

    // Verify Gemini
    try {
      const key = decrypt(cred.gemini_api_key_enc);
      if (key) {
        const res = await axios.get(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
          { timeout: 5000 },
        );
        results.gemini = res.status === 200;
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

    // Verify Facebook page token — check PUBLISH capability, not just readability.
    // A plain user token (or a token missing pages_manage_posts) can read the page
    // name but CANNOT POST to /{page}/feed, so a name-only check gives a false "OK".
    // Asking for `tasks` reveals whether the token may create content on the page,
    // and — if the id is a personal profile, not a Page — Graph errors on `tasks`,
    // which is exactly the misconfiguration we want to surface.
    try {
      const token = decrypt(cred.facebook_page_token_enc);
      if (token && cred.facebook_page_id) {
        const res = await axios.get(
          `https://graph.facebook.com/${GRAPH_VERSION}/${cred.facebook_page_id}?fields=name,tasks&access_token=${token}`,
          { timeout: 6000, validateStatus: () => true },
        );
        if (res.data?.error) {
          results.facebook = false;
          const msg = res.data.error.message || 'unknown error';
          // #100/#803: object not found or wrong node type (e.g. a personal profile id)
          errors.facebook = /tasks|nonexisting|does not exist|Unsupported/i.test(msg)
            ? `${msg} — ודא שהמזהה הוא של דף עסקי (Page), לא פרופיל אישי, ושהטוקן הוא Page Access Token`
            : msg;
        } else {
          const tasks: string[] = Array.isArray(res.data?.tasks) ? res.data.tasks : [];
          const canPublish = tasks.includes('CREATE_CONTENT') || tasks.includes('MANAGE');
          results.facebook = res.status === 200 && canPublish;
          if (!canPublish) {
            errors.facebook = 'הטוקן קורא את הדף אך אין לו הרשאת פרסום. נדרש Page Access Token של אדמין הדף עם ההרשאה pages_manage_posts.';
          }
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
      schedule_last_sent_at: cred.schedule_last_sent_at,
    };
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
      schedule_last_sent_at: cred.schedule_last_sent_at ?? null,
      created_at: cred.created_at,
      updated_at: cred.updated_at,
    };
  }
}
