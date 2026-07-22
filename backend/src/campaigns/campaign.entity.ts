import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

export type CampaignStatus = 'active' | 'paused' | 'draft' | 'error';

@Entity('campaigns')
export class Campaign {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  user_id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column()
  name: string;

  @Column({ default: 'draft' })
  status: CampaignStatus;

  /**
   * Product source. 'aliexpress' = keyword search via the affiliate API (the original
   * behaviour). 'flylink' = rotate the user's linked supplier_products (no keyword search;
   * FLYLINK has no search API). Drives which runner the scheduler picks.
   */
  @Column({ default: 'aliexpress' })
  source: string;

  /**
   * JSON array of target channel_ids the campaign publishes to. FLYLINK requires it (a run
   * with none fails loudly rather than posting nowhere). AliExpress treats it as optional:
   * when set, posts go ONLY to those groups (isolated from other groups); null/[] falls back
   * to the account's default channel (legacy behaviour).
   */
  @Column({ type: 'text', nullable: true })
  target_channels: string | null;

  @Column('text', { array: true, default: '{}' })
  keywords: string[];

  /**
   * Round-robin pointer into `keywords`: each run uses keywords[cursor % len] then advances,
   * so every keyword gets equal airtime and consecutive runs differ. Replaces the old random
   * pick, which over-used some keywords and rarely touched others.
   */
  @Column({ type: 'int', default: 0 })
  keyword_cursor: number;

  @Column({ nullable: true })
  category_id: string;

  @Column('float', { nullable: true })
  min_price: number;

  @Column('float', { nullable: true })
  max_price: number;

  @Column('float', { nullable: true })
  min_discount: number;

  /**
   * Minimum product rating (0–5 stars) to publish. AliExpress product.query has no
   * server-side rating filter, so this is enforced client-side in the runner against
   * each product's evaluate_rate (positive-feedback %). null/0 = no rating filter.
   */
  @Column('float', { nullable: true })
  min_rating: number;

  @Column({ default: '0 9 * * *' })
  schedule_cron: string;

  @Column({ default: 3 })
  posts_per_run: number;

  @Column({ default: 'he' })
  language: string;

  /**
   * JSON array of the platforms THIS campaign publishes to ('telegram' | 'facebook' |
   * 'instagram' | 'pinterest' | 'whatsapp'). When set, the campaign's posts go ONLY to
   * these platforms and the account-global publish toggles stop applying to them — e.g.
   * an English Pinterest-only campaign must not leak into the Hebrew Telegram groups.
   * null/[] = the global toggles (legacy behaviour, unchanged).
   */
  @Column({ type: 'text', nullable: true })
  target_platforms: string | null;

  /**
   * Price-currency override for this campaign ('USD_ILS' | 'USD_USD' | 'USD_EUR' |
   * 'USD_GBP'). An English campaign aimed at a US audience prices in $ while the
   * account default stays ₪. null = the account's currency_pair.
   */
  @Column({ nullable: true })
  currency_pair: string | null;

  /**
   * Per-campaign send-window override, in `window_tz` local hours — so a US-audience
   * Pinterest campaign can publish 17:00–22:00 New-York time while the Israeli
   * campaigns keep the account's 9–22 Israel window. All null = the target group's
   * window, else the account's (legacy behaviour).
   */
  @Column({ type: 'int', nullable: true })
  window_start_hour: number | null;

  @Column({ type: 'int', nullable: true })
  window_end_hour: number | null;

  /** IANA timezone the window hours are read in (e.g. 'America/New_York').
   *  null = the scheduler's default timezone (Asia/Jerusalem). */
  @Column({ nullable: true })
  window_tz: string | null;

  @Column('float', { default: 0 })
  markup_percent: number;

  @Column({ nullable: true, type: 'text' })
  post_template: string;

  @Column({ nullable: true })
  last_run_at: Date;

  @Column({ nullable: true })
  next_run_at: Date;

  @Column({ default: 0 })
  posts_count: number;

  @Column({ default: false })
  use_agents: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
