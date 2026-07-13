import { IsString, IsOptional, IsBoolean, IsInt, IsNumber, IsIn, Min, Max } from 'class-validator';

export class CredentialSetDto {
  @IsOptional()
  @IsString()
  aliexpress_app_key?: string;

  @IsOptional()
  @IsString()
  aliexpress_app_secret?: string;

  @IsOptional()
  @IsString()
  aliexpress_tracking_id?: string;

  @IsOptional()
  @IsString()
  telegram_bot_token?: string;

  @IsOptional()
  @IsString()
  telegram_channel_id?: string;

  @IsOptional()
  @IsString()
  openai_api_key?: string;

  @IsOptional()
  @IsString()
  openai_model?: string;

  // ── Multi-provider AI ──
  @IsOptional()
  @IsIn(['anthropic', 'openai', 'gemini'])
  ai_provider?: string;

  @IsOptional()
  @IsString()
  anthropic_api_key?: string;

  @IsOptional()
  @IsString()
  anthropic_model?: string;

  @IsOptional()
  @IsString()
  gemini_api_key?: string;

  @IsOptional()
  @IsString()
  gemini_model?: string;

  /** Monthly AI token budget for the dashboard usage gauge (0 / omitted = untracked). */
  @IsOptional()
  @IsInt()
  @Min(0)
  ai_monthly_token_budget?: number;

  // ── Facebook / Meta ──
  @IsOptional()
  @IsString()
  facebook_page_id?: string;

  @IsOptional()
  @IsString()
  facebook_page_token?: string;

  @IsOptional()
  @IsString()
  meta_ad_account_id?: string;

  @IsOptional()
  @IsString()
  instagram_business_id?: string;

  @IsOptional()
  @IsBoolean()
  publish_telegram?: boolean;

  @IsOptional()
  @IsBoolean()
  publish_facebook?: boolean;

  @IsOptional()
  @IsBoolean()
  publish_instagram?: boolean;

  // ── Discovery (Apify) ──
  @IsOptional()
  @IsString()
  apify_api_token?: string;

  // ── Auto-boost ──
  @IsOptional()
  @IsBoolean()
  boost_enabled?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  boost_roas_threshold?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  boost_daily_budget?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  boost_hard_limit_usd?: number;

  @IsOptional()
  @IsString()
  boost_target_countries?: string;

  // ── Default templates ──
  @IsOptional()
  @IsString()
  default_body_template_id?: string;

  @IsOptional()
  @IsString()
  default_footer_template_id?: string;

  // ── Pricing converter ──
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  price_markup_pct?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(200)
  price_shipping_buffer_ils?: number;

  @IsOptional()
  @IsIn(['natural', 'charming', 'exact'])
  price_rounding_mode?: string;

  @IsOptional()
  @IsString()
  currency_pair?: string;

  @IsOptional()
  @IsBoolean()
  schedule_enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  schedule_start_hour?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  schedule_end_hour?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  schedule_interval_minutes?: number;
}
