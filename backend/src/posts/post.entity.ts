import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { Campaign } from '../campaigns/campaign.entity';
import { User } from '../users/user.entity';

export type PostStatus = 'pending' | 'sent' | 'failed' | 'scheduled' | 'queued';

@Entity('posts')
export class Post {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  user_id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ nullable: true })
  campaign_id: string;

  @ManyToOne(() => Campaign, { nullable: true })
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign;

  @Column()
  product_id: string;

  @Column()
  product_title: string;

  @Column()
  product_image: string;

  @Column()
  affiliate_url: string;

  @Column('float', { default: 0 })
  original_price_usd: number;

  @Column('float', { default: 0 })
  sale_price_usd: number;

  @Column('float', { default: 0 })
  price_ils: number;

  @Column({ type: 'text' })
  generated_text: string;

  @Column({ nullable: true })
  telegram_message_id: number;

  /** Facebook Graph post id (`{page}_{post}`) once published to a Page */
  @Column({ nullable: true })
  facebook_post_id: string;

  /** Instagram media id once published to an IG Business account */
  @Column({ nullable: true })
  instagram_post_id: string;

  /** Pinterest Pin id once published */
  @Column({ nullable: true })
  pinterest_post_id: string;

  /** WhatsApp message id once published (Green API idMessage) */
  @Column({ nullable: true })
  whatsapp_message_id: string;

  /**
   * Per-POST platform override (JSON array, e.g. '["pinterest"]') — set when the owner
   * chose platforms in the republish dialog. NULL = inherit from the campaign's
   * target_platforms / the account toggles, exactly as before this column existed.
   */
  @Column({ nullable: true })
  target_platforms: string;

  /** Code for the trackable /r/<code> short link — minted at first publish. Clicks on it
   *  land in link_clicks and roll up into clicks_count. */
  @Column({ nullable: true, unique: true })
  short_code: string;

  /** Cached click total (from link_clicks) so the posts list shows clicks without a join. */
  @Column({ type: 'int', default: 0 })
  clicks_count: number;

  /**
   * Outbound clicks this post's Pin drew, pulled from Pinterest's own analytics.
   *
   * A Pin carries the DIRECT affiliate URL — our /r/ redirect risks pin rejection — so a
   * Pinterest click never passes through link_clicks and clicks_count stays 0 forever.
   * The learning engine reads clicks, so without this column a Pinterest campaign is
   * invisible to it: no keyword can ever be judged strong or dead. Kept separate from
   * clicks_count (rather than folded in) because it is SET from analytics on every sync,
   * while clicks_count is incremented per click — mixing the two would double-count a
   * post published to both Telegram and Pinterest.
   */
  @Column({ type: 'int', default: 0 })
  pinterest_clicks: number;

  /** The campaign search keyword that produced this post — attribution inherits it, so
   *  revenue can be reported per keyword. null for manual/non-campaign posts. */
  @Column({ nullable: true, type: 'varchar' })
  keyword: string | null;

  /** Which copy ANGLE this post was written in (see copy-variants.ts). Clicks per post per
   *  angle are how the engine learns which voice a group responds to. null for posts written
   *  before the bandit existed, and for groups whose own template owns the wording. */
  @Column({ nullable: true, type: 'varchar' })
  copy_variant: string | null;

  /** Set when this post is an automatic WINNER RECYCLE of another post (proven clicks/
   *  revenue → republished with fresh AI copy). Points at the original. */
  @Column({ type: 'uuid', nullable: true })
  recycled_from: string | null;

  /** Marks this post as the canonical template a FLYLINK re-post clones for its product
   *  (overrides the default "earliest sent post"). At most one per product per user. */
  @Column({ default: false })
  is_repost_source: boolean;

  /** Marks a limited-time PROMOTION post: it carries deal urgency copy and auto-removes
   *  itself from Telegram once promo_ends_at passes. */
  @Column({ default: false })
  is_promo: boolean;

  /** When the promotion ends. After this, the auto-removal cron deletes the Telegram
   *  message (or, if past Telegram's 48h delete window, edits it to "המבצע הסתיים"). */
  @Column({ nullable: true })
  promo_ends_at: Date;

  /** The deal discount % the user set for this promo — surfaced in the AI copy. */
  @Column({ nullable: true, type: 'int' })
  promo_discount: number | null;

  /** Set once auto-removal has handled the expired promo, so the cron never reprocesses it. */
  @Column({ default: false })
  promo_expired: boolean;

  /** Published by the sales-recovery auto-push (order-drop → extra hot products). Used to
   *  cap how many recovery posts go out per day. */
  @Column({ default: false })
  is_boost: boolean;

  @Column({ default: 'pending' })
  status: PostStatus;

  @Column({ nullable: true, type: 'text' })
  error_message: string;

  @Column({ nullable: true })
  sent_at: Date;

  /** When the post entered 'pending' (a send was claimed). The stuck-post cleanup keys off
   *  this — not created_at — so a post that sat queued for hours isn't declared "stuck" the
   *  instant it starts sending. */
  @Column({ nullable: true })
  pending_at: Date;

  @Column({ nullable: true })
  scheduled_at: Date;

  @Column({ nullable: true })
  queue_order: number;

  @Column({ nullable: true })
  catalog_product_id: string;

  /** Target Telegram chat id for this post (queue/scheduled). null = default channel. */
  @Column({ nullable: true })
  channel_override: string;

  /**
   * JSON array of target channel_ids when a post fans out to MORE THAN ONE group
   * (e.g. published to both מאמא מותגים and טקטי בקליק at once). When set, the post is
   * delivered to every listed group's Telegram chat and its own Facebook page — while
   * still costing a single publish credit. null/empty = single target (channel_override).
   */
  @Column({ nullable: true, type: 'text' })
  channel_overrides: string | null;

  /** JSON array of extra image URLs → sent as a Telegram media group (colors/variants). */
  @Column({ nullable: true, type: 'text' })
  gallery_json: string;

  /** JSON array of channel_ids this post ACTUALLY published to — written when a manual
   *  push sends it somewhere other than its targeting field. DISPLAY ONLY: nothing that
   *  routes a send reads it (see delivered-channels.ts). */
  @Column({ nullable: true, type: 'text' })
  delivered_channels: string | null;

  /** The product's own video (AliExpress product_video_url). Published instead of the
   *  image on Telegram/WhatsApp when the account opted in (prefer_product_video); any
   *  video failure falls back to the image, and image platforms never use it. */
  @Column({ nullable: true, type: 'text' })
  product_video: string | null;

  /** The owner picked only videos for this post (no photos): Telegram sends just them and
   *  WhatsApp sends product_video, whatever the account setting. */
  @Column({ default: false })
  send_as_video: boolean;

  /** Videos the owner picked into the album, `[{ url, at }]` with `at` their place in his
   *  selection (album-videos.ts). Kept out of gallery_json, which every non-Telegram
   *  platform reads as photos. NULL = no video picked. */
  @Column({ nullable: true, type: 'text' })
  album_videos: string | null;

  /** AliExpress Brand+ ("Certified Original") listing — an official brand-store product.
   *  Detected from the affiliate API's platform_product_type; buildPostBody turns it into
   *  an emphasized authenticity line in the post. */
  @Column({ default: false })
  is_brand_plus: boolean;

  /** When set, gallery_json images are composed into collage sheets (this many per sheet) → one album. */
  @Column({ nullable: true, type: 'int' })
  collage_cells: number | null;

  @CreateDateColumn()
  created_at: Date;
}
