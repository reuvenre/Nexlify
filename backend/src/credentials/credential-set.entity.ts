import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

@Entity('credential_sets')
export class CredentialSet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  user_id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ nullable: true })
  aliexpress_app_key: string;

  @Column({ nullable: true })
  aliexpress_app_secret_enc: string;

  @Column({ nullable: true })
  aliexpress_tracking_id: string;

  @Column({ nullable: true })
  telegram_bot_token_enc: string;

  @Column({ nullable: true })
  telegram_channel_id: string;

  @Column({ nullable: true })
  openai_api_key_enc: string;

  @Column({ default: 'gpt-4o-mini' })
  openai_model: string;

  /* ── Multi-provider AI ─────────────────────────────────────────────────── */

  /** Active content-generation provider: 'anthropic' | 'openai' | 'gemini' */
  @Column({ default: 'anthropic' })
  ai_provider: string;

  /** Per-user Anthropic key (falls back to the global ANTHROPIC_API_KEY env) */
  @Column({ nullable: true })
  anthropic_api_key_enc: string;

  @Column({ default: 'claude-sonnet-4-6' })
  anthropic_model: string;

  @Column({ nullable: true })
  gemini_api_key_enc: string;

  @Column({ default: 'gemini-2.5-flash' })
  gemini_model: string;

  /** Optional monthly AI token budget — powers the dashboard usage gauge / quota
   *  early-warning. null = untracked (widget shows consumption only). */
  @Column({ type: 'int', nullable: true })
  ai_monthly_token_budget: number | null;

  /* ── Facebook / Meta publishing ────────────────────────────────────────── */

  @Column({ nullable: true })
  facebook_page_id: string;

  @Column({ nullable: true })
  facebook_page_token_enc: string;

  @Column({ nullable: true })
  meta_ad_account_id: string;

  /** Instagram Business account id (linked to the Facebook Page above). Publishing
   *  reuses the Page access token with instagram_basic + instagram_content_publish. */
  @Column({ nullable: true })
  instagram_business_id: string;

  /** Whether each channel is part of the default publish fan-out */
  @Column({ default: true })
  publish_telegram: boolean;

  @Column({ default: false })
  publish_facebook: boolean;

  @Column({ default: false })
  publish_instagram: boolean;

  /** Whether every post also fans out to Pinterest (needs pinterest_access_token + board). */
  @Column({ default: false })
  publish_pinterest: boolean;

  /** Make.com incoming-webhook URL. When publish_via_make is on, Facebook posts are
   *  delivered by POSTing the post to this webhook (which drives the user's own Make
   *  scenario + its authorized Facebook connection) instead of our direct Graph API. */
  @Column({ nullable: true })
  make_webhook_url: string;

  @Column({ default: false })
  publish_via_make: boolean;

  /** Auto-enhance product photos (sharpen / brighten / colour) before publishing. */
  @Column({ default: false })
  image_enhance_enabled: boolean;

  /** Min minutes between Facebook posts per page (0 = every post). Paces Facebook
   *  independently of Telegram so high-frequency posting doesn't hit FB's spam block. */
  @Column({ type: 'int', default: 0 })
  facebook_min_interval_minutes: number;

  /* ── Product discovery (Apify) ─────────────────────────────────────────── */

  @Column({ nullable: true })
  apify_api_token_enc: string;

  /* ── Scaffolded integrations (credentials stored; activation pending the
   *    user's external account / API approval — no publish path wired yet) ── */

  // WhatsApp Business (Cloud API)
  @Column({ nullable: true })
  whatsapp_phone_number_id: string;

  @Column({ nullable: true })
  whatsapp_access_token_enc: string;

  // Amazon Associates (PA-API)
  @Column({ nullable: true })
  amazon_access_key: string;

  @Column({ nullable: true })
  amazon_secret_key_enc: string;

  @Column({ nullable: true })
  amazon_partner_tag: string;

  // Pinterest
  @Column({ nullable: true })
  pinterest_access_token_enc: string;

  @Column({ nullable: true })
  pinterest_board_id: string;

  /* ── Auto-boost (Meta Ads, ROAS-driven) ────────────────────────────────── */

  @Column({ default: false })
  boost_enabled: boolean;

  /** Minimum ROAS (or organic-click signal) required to boost a post */
  @Column('float', { default: 2.0 })
  boost_roas_threshold: number;

  /** Daily budget per boosted ad, in the user's display currency */
  @Column({ default: 50 })
  boost_daily_budget: number;

  /** Hard lifetime spend cap across the ad account, in USD */
  @Column({ default: 200 })
  boost_hard_limit_usd: number;

  /** Minimum REAL organic commission (USD) a post must earn before we boost it. */
  @Column({ type: 'float', nullable: true })
  boost_min_revenue_usd: number;

  /** Comma-separated ISO country codes for boosted-ad targeting (e.g. "IL,US") */
  @Column({ default: 'IL' })
  boost_target_countries: string;

  /* ── Default post templates ────────────────────────────────────────────── */

  /** Default body template id (a builtin id like 'builtin_default' or a uuid) */
  @Column({ nullable: true })
  default_body_template_id: string;

  /** Default footer template id (uuid) — appended to every sent post */
  @Column({ nullable: true })
  default_footer_template_id: string;

  /* ── Pricing (USD→ILS converter) ───────────────────────────────────────── */

  /** Reseller margin added to the converted price (0–100%) */
  @Column('float', { default: 0 })
  price_markup_pct: number;

  /** Flat shipping buffer added before markup, in display currency (0–200) */
  @Column('float', { default: 0 })
  price_shipping_buffer_ils: number;

  /** Rounding mode for final prices: 'natural' | 'charming' | 'exact' */
  @Column({ default: 'exact' })
  price_rounding_mode: string;

  @Column({ default: 'USD_ILS' })
  currency_pair: string;

  /* ── Scheduling Queue Settings ─────────────────────────────────────────── */

  @Column({ default: false })
  schedule_enabled: boolean;

  /** Hour of day (0-23) when auto-queue starts sending */
  @Column({ default: 9 })
  schedule_start_hour: number;

  /** Hour of day (0-23) after which auto-queue stops sending */
  @Column({ default: 22 })
  schedule_end_hour: number;

  /** Minimum minutes between each queued post send */
  @Column({ default: 60 })
  schedule_interval_minutes: number;

  /** Timestamp of last queue post sent (used to enforce interval) */
  @Column({ nullable: true })
  schedule_last_sent_at: Date;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
