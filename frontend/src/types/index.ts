// ─── Auth ───────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  footer_text?: string;
  created_at: string;
}

export interface AuthResponse {
  access_token: string;
  user: User;
}

// ─── Credentials ─────────────────────────────────────────────────────────────

export interface CredentialSet {
  id: string;
  aliexpress_app_key: string;
  aliexpress_app_secret: string;  // masked
  aliexpress_tracking_id: string;
  telegram_bot_token: string;     // masked
  telegram_channel_id: string;
  openai_api_key: string;         // masked
  openai_model: string;
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
  currency_pair?: string;
  // Scheduling
  schedule_enabled?: boolean;
  schedule_start_hour?: number;
  schedule_end_hour?: number;
  schedule_interval_minutes?: number;
}

// ─── Campaigns ───────────────────────────────────────────────────────────────

export type CampaignStatus = 'active' | 'paused' | 'draft' | 'error';

export interface Campaign {
  id: string;
  name: string;
  status: CampaignStatus;
  keywords: string[];
  category_id?: string;
  min_price?: number;
  max_price?: number;
  min_discount?: number;
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
  keywords: string[];
  category_id?: string;
  min_price?: number;
  max_price?: number;
  min_discount?: number;
  schedule_cron: string;
  posts_per_run: number;
  language?: 'he' | 'en' | 'ar';
  markup_percent?: number;
  post_template?: string;
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
  synced_at?: string;
  created_at: string;
  updated_at: string;
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
  created_at: string;
}

export interface PostPreview {
  product: AliProduct;
  generated_text: string;
  price_ils: number;
  exchange_rate: number;
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
  members_count: number;
  created_at: string;
  updated_at: string;
}

export interface CreateChannelInput {
  name: string;
  platform?: ChannelPlatform;
  bot_token?: string;
  channel_id?: string;
  description?: string;
}

export interface UpdateChannelInput {
  name?: string;
  bot_token?: string;
  channel_id?: string;
  description?: string;
  is_active?: boolean;
}

// ─── Recommendations (agent inbox) ──────────────────────────────────────────

export type RecommendationAgentType = 'site_manager' | 'frontend_architect' | 'backend_architect' | 'security';
export type RecommendationCategory = 'strategy' | 'code_change' | 'security' | 'campaign_action';
export type RecommendationSeverity = 'low' | 'medium' | 'high' | 'critical';
export type RecommendationStatus = 'pending' | 'approved' | 'rejected' | 'applied';

export interface AgentRecommendation {
  id: string;
  user_id: string;
  agent_type: RecommendationAgentType;
  category: RecommendationCategory;
  severity: RecommendationSeverity;
  title: string;
  description: string;
  payload?: Record<string, any> | null;
  status: RecommendationStatus;
  reviewed_at?: string;
  review_note?: string;
  created_at: string;
  updated_at: string;
}

// ─── Agents ──────────────────────────────────────────────────────────────────

export type AgentType = 'product' | 'content' | 'campaign' | 'orchestrator' | 'site_manager' | 'frontend_architect' | 'backend_architect' | 'security';

export interface AgentRun {
  id: string;
  campaign_id?: string;
  agent_type: AgentType;
  status: 'running' | 'completed' | 'failed';
  input?: Record<string, any> | null;
  output?: Record<string, any> | null;
  tokens_used?: number;
  error_message?: string;
  started_at: string;
  finished_at?: string;
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
