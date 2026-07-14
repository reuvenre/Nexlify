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

  @IsOptional()
  @IsString()
  make_webhook_url?: string;

  @IsOptional()
  @IsBoolean()
  publish_via_make?: boolean;

  @IsOptional()
  @IsBoolean()
  image_enhance_enabled?: boolean;

  // ── Discovery (Apify) ──
  @IsOptional()
  @IsString()
  apify_api_token?: string;

  // ── Scaffolded integrations (stored; activation pending external accounts) ──
  @IsOptional() @IsString() whatsapp_phone_number_id?: string;
  @IsOptional() @IsString() whatsapp_access_token?: string;
  @IsOptional() @IsString() amazon_access_key?: string;
  @IsOptional() @IsString() amazon_secret_key?: string;
  @IsOptional() @IsString() amazon_partner_tag?: string;
  @IsOptional() @IsString() pinterest_access_token?: string;
  @IsOptional() @IsString() pinterest_board_id?: string;

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

  /** Minimum real organic commission (USD) before a post is boosted. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  boost_min_revenue_usd?: number;

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
