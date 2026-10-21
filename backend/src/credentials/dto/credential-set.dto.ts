import { IsString, IsOptional, IsBoolean, IsInt, IsNumber, IsIn, IsArray, Min, Max } from 'class-validator';

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
  @IsBoolean()
  publish_pinterest?: boolean;

  @IsOptional()
  @IsString()
  make_webhook_url?: string;

  @IsOptional()
  @IsBoolean()
  publish_via_make?: boolean;

  @IsOptional()
  @IsBoolean()
  image_enhance_enabled?: boolean;

  @IsOptional()
  @IsString()
  image_enhance_mode?: string;

  @IsOptional()
  @IsBoolean()
  prefer_product_video?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  facebook_min_interval_minutes?: number;

  // ── Discovery (Apify) ──
  @IsOptional()
  @IsString()
  apify_api_token?: string;

  // ── Reels: fal.ai image-to-video ──
  @IsOptional()
  @IsString()
  fal_api_key?: string;

  // ── Scaffolded integrations (stored; activation pending external accounts) ──
  @IsOptional() @IsString() whatsapp_phone_number_id?: string;
  @IsOptional() @IsString() whatsapp_access_token?: string;
  @IsOptional() @IsString() whatsapp_provider?: string;
  @IsOptional() @IsString() green_api_url?: string;
  @IsOptional() @IsString() green_api_instance_id?: string;
  @IsOptional() @IsString() green_api_token?: string;
  @IsOptional() @IsString() whatsapp_group_id?: string;
  @IsOptional() @IsBoolean() publish_whatsapp?: boolean;
  @IsOptional() @IsString() amazon_access_key?: string;
  @IsOptional() @IsString() amazon_secret_key?: string;
  @IsOptional() @IsString() amazon_partner_tag?: string;
  @IsOptional() @IsString() pinterest_access_token?: string;
  @IsOptional() @IsString() pinterest_board_id?: string;
  @IsOptional() @IsString() pinterest_app_id?: string;
  @IsOptional() @IsString() pinterest_app_secret?: string;

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
  // 24 = "עד חצות": the window runs to the end of the day, so the 23:00 hour is a real
  // sending hour. The channel DTO already allowed 24; capping the GLOBAL window at 23 was
  // the inconsistency that made "publish until midnight" impossible to configure — the UI
  // only offered 00:00, which is 0, which fails the start<end check.
  @Max(24)
  schedule_end_hour?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  schedule_interval_minutes?: number;

  @IsOptional()
  @IsBoolean()
  seasonal_enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  recycle_winners_enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  optimizer_enabled?: boolean;

  @IsOptional()
  @IsNumber()
  recycle_min_clicks?: number;

  @IsOptional()
  @IsBoolean()
  recovery_enabled?: boolean;

  @IsOptional()
  @IsNumber()
  recovery_min_orders?: number;

  @IsOptional()
  @IsNumber()
  recovery_window_days?: number;

  @IsOptional()
  @IsNumber()
  recovery_posts_per_day?: number;

  /** Campaign ids opted into recovery boosts. Empty/omitted = every active campaign. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  recovery_campaign_ids?: string[];
}
