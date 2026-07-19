// ─── Auth ───────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  role?: 'user' | 'admin';
  footer_text?: string;
  subscription_plan?: PlanId;
  credits_remaining?: number;
  totp_enabled?: boolean;
  created_at: string;
}

/** Login response: either a full session, or a 2FA challenge to complete. */
export interface LoginResult extends Partial<AuthResponse> {
  mfa_required?: boolean;
  mfa_token?: string;
}

export interface AdminUser {
  id: string;
  email: string;
  role: 'user' | 'admin';
  created_at: string;
  via_google: boolean;
  subscription_plan?: PlanId;
  plan_billing?: 'monthly' | 'annual';
  credits_remaining?: number;
  is_blocked?: boolean;
  posts_count: number;
  campaigns_count: number;
}

export interface BroadcastChannelResult {
  configured?: boolean;
  total: number;
  sent: number;
  failed: number;
  note?: string;
  mode?: 'text' | 'template';
  error?: string;
}

export interface BroadcastResult {
  email?: BroadcastChannelResult;
  telegram?: BroadcastChannelResult;
  whatsapp?: BroadcastChannelResult;
}

// ─── Subscription ────────────────────────────────────────────────────────────

export type PlanId = 'starter' | 'growth' | 'autopilot' | 'scale';
export type BillingCycle = 'monthly' | 'annual';

export interface PlanDef {
  id: PlanId;
  name: string;
  price_monthly: number;
  price_annual: number;
  monthly_credits: number;
  max_groups: number | null;
  popular: boolean;
}

export interface SubscriptionStatus {
  plan: PlanId;
  plan_name: string;
  billing: BillingCycle;
  price: number;
  credits_remaining: number;
  monthly_credits: number;
  max_groups: number | null;
  renews_at: string | null;
}

export interface AdminStats {
  total_users: number;
  admins: number;
  google_users: number;
}

// ─── AI token usage (dashboard metering) ─────────────────────────────────────

export interface DailyUsage {
  day: string; // YYYY-MM-DD (Asia/Jerusalem)
  total_tokens: number;
  prompt_tokens: number;
  output_tokens: number;
  calls: number;
}

export interface AiUsageSummary {
  today: DailyUsage;
  month_total: number;
  days: DailyUsage[];              // continuous series, oldest→newest
  budget: number | null;          // user-set monthly token budget
  remaining: number | null;       // budget − month_total (≥0), null if no budget
  by_provider: { provider: string; total_tokens: number }[];
}

export interface AuthResponse {
  access_token: string;
  refresh_token?: string;
  user: User;
}

// ─── Credentials ─────────────────────────────────────────────────────────────

export type AiProvider = 'anthropic' | 'openai' | 'gemini';

export interface CredentialSet {
  id: string;
  aliexpress_app_key: string;
  aliexpress_app_secret: string;  // masked
  aliexpress_tracking_id: string;
  telegram_bot_token: string;     // masked
  telegram_channel_id: string;
  openai_api_key: string;         // masked
  openai_model: string;
  // Multi-provider AI
  ai_provider: AiProvider;
  anthropic_api_key: string;      // masked
  anthropic_model: string;
  gemini_api_key: string;         // masked
  gemini_model: string;
  ai_monthly_token_budget: number | null;
  /** AI generation is usable — a per-user key OR the server's shared key. Read-only. */
  ai_ready: boolean;
  // Facebook / Meta
  facebook_page_id: string;
  facebook_page_token: string;    // masked
  meta_ad_account_id: string;
  instagram_business_id: string;
  publish_telegram: boolean;
  publish_facebook: boolean;
  publish_instagram: boolean;
  make_webhook_url: string;
  publish_via_make: boolean;
  image_enhance_enabled: boolean;
  facebook_min_interval_minutes: number;
  // Discovery
  apify_api_token: string;        // masked
  // Scaffolded integrations (activation pending external accounts)
  whatsapp_phone_number_id: string;
  whatsapp_access_token: string;  // masked
  amazon_access_key: string;
  amazon_secret_key: string;      // masked
  amazon_partner_tag: string;
  pinterest_access_token: string; // masked
  pinterest_board_id: string;
  // Auto-boost
  boost_enabled: boolean;
  boost_roas_threshold: number;
  boost_min_revenue_usd: number;
  boost_daily_budget: number;
  boost_hard_limit_usd: number;
  boost_target_countries: string;
  // Default templates
  default_body_template_id: string;
  default_footer_template_id: string | null;
  // Pricing converter
  price_markup_pct: number;
  price_shipping_buffer_ils: number;
  price_rounding_mode: 'natural' | 'charming' | 'exact';
  currency_pair: 'USD_ILS' | 'USD_EUR' | 'USD_GBP';
  // Scheduling queue
  schedule_enabled: boolean;
  schedule_start_hour: number;
  schedule_end_hour: number;
  schedule_interval_minutes: number;
  schedule_last_sent_at?: string;
  created_at: string;
  updated_at: string;
}

export interface CredentialSetInput {
  aliexpress_app_key: string;
  aliexpress_app_secret: string;
  aliexpress_tracking_id: string;
  telegram_bot_token: string;
  telegram_channel_id: string;
  openai_api_key: string;
  openai_model?: string;
  // Multi-provider AI
  ai_provider?: AiProvider;
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
  make_webhook_url?: string;
  publish_via_make?: boolean;
  image_enhance_enabled?: boolean;
  facebook_min_interval_minutes?: number;
  // Discovery
  apify_api_token?: string;
  // Scaffolded integrations
  whatsapp_phone_number_id?: string;
  whatsapp_access_token?: string;
  amazon_access_key?: string;
  amazon_secret_key?: string;
  amazon_partner_tag?: string;
  pinterest_access_token?: string;
  pinterest_board_id?: string;
  // Auto-boost
  boost_enabled?: boolean;
  boost_roas_threshold?: number;
  boost_min_revenue_usd?: number;
  boost_daily_budget?: number;
  boost_hard_limit_usd?: number;
  // Default templates
  default_body_template_id?: string;
  default_footer_template_id?: string;
  // Pricing converter
  price_markup_pct?: number;
  price_shipping_buffer_ils?: number;
  price_rounding_mode?: 'natural' | 'charming' | 'exact';
  currency_pair?: string;
  // Scheduling
  schedule_enabled?: boolean;
  schedule_start_hour?: number;
  schedule_end_hour?: number;
  schedule_interval_minutes?: number;
}

export interface VerifyResult {
  aliexpress: boolean;
  telegram: boolean;
  openai: boolean;
  gemini: boolean;
  anthropic: boolean;
  facebook: boolean;
  instagram: boolean;
  metaAdAccount: boolean;
  apify: boolean;
  errors?: Partial<Record<'telegram' | 'openai' | 'gemini' | 'anthropic' | 'facebook' | 'instagram' | 'metaAdAccount', string>>;
}

// ─── Suppliers (Yupoo ↔ FLYLINK) ─────────────────────────────────────────────

export type SkuMatchMode = 'exact' | 'numeric' | 'prefix_map' | 'regex';

export interface SupplierCatalog {
  id: string;
  name: string;
  source_type: string;
  source_store?: string;
  affiliate_network: string;
  sku_match_mode: SkuMatchMode;
  sku_match_config?: Record<string, any>;
  selectors_json?: string;
  target_channel_id?: string;
  /** Whether a Yupoo store password is set (the value itself is never sent to the client). */
  has_password?: boolean;
  enabled: boolean;
  created_at: string;
}

export interface SupplierProduct {
  id: string;
  supplier_catalog_id: string;
  sku?: string;
  title: string;
  description?: string;
  image_url?: string;
  gallery_json?: string;
  price: number;
  currency: string;
  price_ils?: number;        // price converted to the user's currency (from the list endpoint)
  display_currency?: string; // target currency code for price_ils
  yupoo_url?: string;
  flylink_url?: string;
  in_stock?: boolean;
  status: string;
  has_post: boolean;
  /** Publishing lifecycle from the product's posts: 'pending' = in queue / scheduled,
   *  'sent' = published, null = not posted yet. */
  publish_status?: 'pending' | 'sent' | null;
  synced_at?: string;
  created_at: string;
}

// ─── Discovery ───────────────────────────────────────────────────────────────

export interface HuntResult {
  keyword_count: number;
  scraped: number;
  saved: number;
  skipped_existing: number;
}

export interface ValidateResult {
  checked: number;
  valid: number;
  invalid: number;
}

// ─── Campaigns ───────────────────────────────────────────────────────────────

export type CampaignStatus = 'active' | 'paused' | 'draft' | 'error';

export type CampaignSource = 'aliexpress' | 'flylink';

export interface Campaign {
  id: string;
  name: string;
  status: CampaignStatus;
  /** 'aliexpress' = keyword search; 'flylink' = rotate the linked supplier catalog. */
  source: CampaignSource;
  /** FLYLINK only: target group channel_ids. */
  target_channels: string[];
  keywords: string[];
  category_id?: string;
  min_price?: number;
  max_price?: number;
  min_discount?: number;
  /** Minimum star rating (0–5) a product must have to be published. */
  min_rating?: number;
  schedule_cron: string;
  posts_per_run: number;
  language: 'he' | 'en' | 'ar';
  markup_percent: number;
  post_template?: string;
  last_run_at?: string;
  next_run_at?: string;
  posts_count: number;
  created_at: string;
  updated_at: string;
}

export interface CampaignInput {
  name: string;
  source?: CampaignSource;
  target_channels?: string[];
  keywords: string[];
  category_id?: string;
  min_price?: number;
  max_price?: number;
  min_discount?: number;
  min_rating?: number;
  schedule_cron: string;
  posts_per_run: number;
  language?: 'he' | 'en' | 'ar';
  markup_percent?: number;
  post_template?: string;
}

/** What a "run now" actually did. `searched` differs from `keyword` when a Hebrew
 *  keyword was translated to English for the AliExpress query. Posts are QUEUED, not sent
 *  immediately — they publish through the auto-send schedule. */
export interface CampaignRunResult {
  queued: number;
  failed: number;
  keyword: string;
  searched: string;
  errors: string[];
}

// ─── Products ────────────────────────────────────────────────────────────────

export interface AliCategory {
  id: string;
  name: string;
  parent_id: string | null;
}

export interface AliProduct {
  product_id: string;
  title: string;
  original_price: number;
  sale_price: number;
  sale_price_usd?: number;
  discount_percent: number;
  image_url: string;
  product_url: string;
  affiliate_url?: string;
  category: string;
  orders_count: number;
  rating: number;
  currency: string;
}

// ─── Catalog ─────────────────────────────────────────────────────────────────

export type CatalogStatus = 'pending' | 'approved' | 'rejected';

export interface CatalogProduct {
  id: string;
  user_id: string;
  product_id: string;
  title: string;
  description?: string;
  post_text?: string;
  original_price: number;
  sale_price: number;
  currency: string;
  discount_percent: number;
  image_url: string;
  product_url: string;
  affiliate_url?: string;
  category: string;
  keyword?: string;
  orders_count: number;
  rating: number;
  coupon_code?: string;
  commission_rate: number;
  evaluation_rate: number;
  status: CatalogStatus;
  supplier: string;
  has_post: boolean;
  /** Publishing lifecycle derived from the product's posts: 'pending' = in queue /
   *  scheduled, 'sent' = published, null = not posted yet. */
  publish_status?: 'pending' | 'sent' | null;
  synced_at?: string;
  created_at: string;
  updated_at: string;
}

export interface ResyncJob {
  running: boolean;
  started?: boolean;
  total: number;
  done: number;
  updated: number;
  failed: number;
}

export interface CatalogStats {
  total: number;
  approved: number;
  pending: number;
  rejected: number;
  with_post: number;
  categories: number;
  suppliers: number;
}

// ─── Posts ───────────────────────────────────────────────────────────────────

export type PostStatus = 'pending' | 'sent' | 'failed' | 'scheduled' | 'queued';

export interface Post {
  id: string;
  campaign_id: string;
  campaign_name?: string;
  product_id: string;
  product_title: string;
  product_image: string;
  affiliate_url: string;
  original_price_usd: number;
  sale_price_usd: number;
  price_ils: number;
  generated_text: string;
  telegram_message_id?: number;
  status: PostStatus;
  error_message?: string;
  sent_at?: string;
  scheduled_at?: string;
  queue_order?: number;
  catalog_product_id?: string;
  /** Target Telegram group (channel_id). null = default channel. */
  channel_override?: string | null;
  /** JSON array of channel_ids when the post fans out to several groups at once. */
  channel_overrides?: string | null;
  created_at: string;
}

export interface PostPreview {
  product: AliProduct;
  generated_text: string;
  price_ils: number;
  exchange_rate: number;
  /**
   * The coupon line that will be appended when the post is sent, or null if no coupon
   * applies. Kept out of generated_text on purpose — the coupon is re-resolved at send
   * time so a code that expires while the post waits in the queue never goes out.
   */
  coupon_line?: string | null;
}

// ─── Templates ───────────────────────────────────────────────────────────────

export interface PostTemplate {
  id: string;
  name: string;
  content: string;
  icon: string;
  type?: 'body' | 'footer';
  builtin?: boolean;  // client-side flag for predefined templates
  created_at?: string;
}

// ─── Earnings ────────────────────────────────────────────────────────────────

export type EarningStatus = 'estimated' | 'settled' | 'cancelled';

export interface Earning {
  id: string;
  campaign_id?: string;
  order_id: string;
  product_id: string;
  order_amount_usd: number;
  commission_usd: number;
  commission_ils: number;
  status: EarningStatus;
  order_date: string;
  settlement_date?: string;
}

export interface EarningsSummary {
  total_estimated: number;
  total_settled: number;
  total_cancelled: number;
  period_start: string;
  period_end: string;
  by_campaign: {
    campaign_id: string;
    campaign_name: string;
    total: number;
  }[];
  by_month: {
    month: string;
    estimated: number;
    settled: number;
  }[];
}

// ─── Channels ────────────────────────────────────────────────────────────────

export type ChannelPlatform = 'telegram';

export interface Channel {
  id: string;
  name: string;
  platform: ChannelPlatform;
  channel_id: string;
  description: string;
  is_active: boolean;
  has_token: boolean;
  bot_token_masked: string | null;
  body_template_id: string | null;
  footer_template_id: string | null;
  facebook_page_id: string;
  /** Whether this channel has its own Facebook Page token (never the token itself). */
  has_fb_token: boolean;
  fb_token_masked: string | null;
  /** Per-group send queue. null on any field = inherit the global schedule setting. */
  schedule_enabled: boolean | null;
  schedule_interval_minutes: number | null;
  schedule_start_hour: number | null;
  schedule_end_hour: number | null;
  schedule_last_sent_at: string | null;
  members_count: number;
  created_at: string;
  updated_at: string;
}

// ─── Notifications ───────────────────────────────────────────────────────────

export interface NotificationPrefs {
  daily_summary: boolean;
  campaign_errors: boolean;
  last_daily_sent_on: string | null;
  /** False when SMTP isn't configured — nothing can actually be delivered. */
  smtp_ready: boolean;
}

// ─── Coupons ──────────────────────────────────────────────────────────────────

export interface Coupon {
  id: string;
  code: string;
  discount_usd: number;
  min_spend_usd: number;
  campaign: string | null;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  created_at: string;
}

/** A coupon row detected in a pasted block, before saving. */
export interface ParsedCoupon {
  code: string;
  discount_usd: number;
  min_spend_usd: number;
}

export interface CreateChannelInput {
  name: string;
  platform?: ChannelPlatform;
  bot_token?: string;
  channel_id?: string;
  description?: string;
  footer_template_id?: string;
  facebook_page_id?: string;
  facebook_page_token?: string;
}

export interface UpdateChannelInput {
  name?: string;
  bot_token?: string;
  channel_id?: string;
  description?: string;
  is_active?: boolean;
  body_template_id?: string;
  footer_template_id?: string;
  facebook_page_id?: string;
  facebook_page_token?: string;
  /** Per-group send queue. Send null to clear an override (back to the global schedule). */
  schedule_enabled?: boolean | null;
  schedule_interval_minutes?: number | null;
  schedule_start_hour?: number | null;
  schedule_end_hour?: number | null;
}

// ─── API ──────────────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface ApiError {
  message: string;
  statusCode: number;
  error?: string;
}
