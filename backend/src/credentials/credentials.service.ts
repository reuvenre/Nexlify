import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CredentialSet } from './credential-set.entity';
import { CredentialSetDto } from './dto/credential-set.dto';
import { encrypt, decrypt, mask } from '../common/crypto';
import axios from 'axios';

export interface DecryptedCredentials {
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
  // Facebook / Meta
  facebook_page_id?: string;
  facebook_page_token?: string;
  meta_ad_account_id?: string;
  publish_telegram?: boolean;
  publish_facebook?: boolean;
  // Discovery
  apify_api_token?: string;
  // Auto-boost
  boost_enabled?: boolean;
  boost_roas_threshold?: number;
  boost_daily_budget?: number;
  boost_hard_limit_usd?: number;
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

    // Facebook / Meta (non-secret)
    if (dto.facebook_page_id?.trim())        cred.facebook_page_id = dto.facebook_page_id.trim();
    if (dto.meta_ad_account_id?.trim())      cred.meta_ad_account_id = dto.meta_ad_account_id.trim();
    if (dto.publish_telegram !== undefined)  cred.publish_telegram = dto.publish_telegram;
    if (dto.publish_facebook !== undefined)  cred.publish_facebook = dto.publish_facebook;

    // Auto-boost settings
    if (dto.boost_enabled !== undefined)         cred.boost_enabled = dto.boost_enabled;
    if (dto.boost_roas_threshold !== undefined)  cred.boost_roas_threshold = dto.boost_roas_threshold;
    if (dto.boost_daily_budget !== undefined)    cred.boost_daily_budget = dto.boost_daily_budget;
    if (dto.boost_hard_limit_usd !== undefined)  cred.boost_hard_limit_usd = dto.boost_hard_limit_usd;

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

    await this.repo.save(cred);
    return this.toPublic(cred);
  }

  async verify(userId: string): Promise<{
    aliexpress: boolean; telegram: boolean; openai: boolean;
    gemini: boolean; facebook: boolean; apify: boolean;
  }> {
    const empty = { aliexpress: false, telegram: false, openai: false, gemini: false, facebook: false, apify: false };
    const cred = await this.repo.findOne({ where: { user_id: userId } });
    if (!cred) return empty;

    const results = { ...empty };

    // Verify Telegram
    try {
      const token = decrypt(cred.telegram_bot_token_enc);
      const res = await axios.get(`https://api.telegram.org/bot${token}/getMe`, { timeout: 5000 });
      results.telegram = res.data?.ok === true;
    } catch {}

    // Verify OpenAI
    try {
      const key = decrypt(cred.openai_api_key_enc);
      if (key) {
        const res = await axios.get('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
          timeout: 5000,
        });
        results.openai = res.status === 200;
      }
    } catch {}

    // Verify Gemini
    try {
      const key = decrypt(cred.gemini_api_key_enc);
      if (key) {
        const res = await axios.get(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
          { timeout: 5000 },
        );
        results.gemini = res.status === 200;
      }
    } catch {}

    // Verify Facebook page token
    try {
      const token = decrypt(cred.facebook_page_token_enc);
      if (token && cred.facebook_page_id) {
        const res = await axios.get(
          `https://graph.facebook.com/v19.0/${cred.facebook_page_id}?fields=name&access_token=${token}`,
          { timeout: 5000 },
        );
        results.facebook = res.status === 200 && !res.data?.error;
      }
    } catch {}

    // Apify: token presence (full validation requires a paid run)
    results.apify = !!decrypt(cred.apify_api_token_enc);

    // AliExpress: just check that keys are set
    results.aliexpress = !!(cred.aliexpress_app_key && cred.aliexpress_tracking_id);

    return results;
  }

  // Return decrypted credentials for internal use
  async getRaw(userId: string): Promise<DecryptedCredentials | null> {
    const cred = await this.repo.findOne({ where: { user_id: userId } });
    if (!cred) return null;
    return {
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
      facebook_page_id: cred.facebook_page_id,
      facebook_page_token: decrypt(cred.facebook_page_token_enc),
      meta_ad_account_id: cred.meta_ad_account_id,
      publish_telegram: cred.publish_telegram,
      publish_facebook: cred.publish_facebook,
      apify_api_token: decrypt(cred.apify_api_token_enc),
      boost_enabled: cred.boost_enabled,
      boost_roas_threshold: cred.boost_roas_threshold,
      boost_daily_budget: cred.boost_daily_budget,
      boost_hard_limit_usd: cred.boost_hard_limit_usd,
      currency_pair: cred.currency_pair,
      schedule_enabled: cred.schedule_enabled,
      schedule_start_hour: cred.schedule_start_hour,
      schedule_end_hour: cred.schedule_end_hour,
      schedule_interval_minutes: cred.schedule_interval_minutes,
      schedule_last_sent_at: cred.schedule_last_sent_at,
    };
  }

  /** Returns all credential sets with scheduling enabled (for queue cron) */
  async getAllSchedulingEnabled(): Promise<CredentialSet[]> {
    return this.repo.find({ where: { schedule_enabled: true } });
  }

  /** Returns all credential sets with auto-boost enabled (for the Ads cron) */
  async getAllBoostEnabled(): Promise<CredentialSet[]> {
    return this.repo.find({ where: { boost_enabled: true } });
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
      // Facebook / Meta
      facebook_page_id: cred.facebook_page_id || '',
      facebook_page_token: cred.facebook_page_token_enc ? mask(decrypt(cred.facebook_page_token_enc)) : '',
      meta_ad_account_id: cred.meta_ad_account_id || '',
      publish_telegram: cred.publish_telegram ?? true,
      publish_facebook: cred.publish_facebook ?? false,
      // Discovery
      apify_api_token: cred.apify_api_token_enc ? mask(decrypt(cred.apify_api_token_enc)) : '',
      // Auto-boost
      boost_enabled: cred.boost_enabled ?? false,
      boost_roas_threshold: cred.boost_roas_threshold ?? 2.0,
      boost_daily_budget: cred.boost_daily_budget ?? 50,
      boost_hard_limit_usd: cred.boost_hard_limit_usd ?? 200,
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
