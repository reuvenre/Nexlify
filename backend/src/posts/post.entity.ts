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

  /** Marks this post as the canonical template a FLYLINK re-post clones for its product
   *  (overrides the default "earliest sent post"). At most one per product per user. */
  @Column({ default: false })
  is_repost_source: boolean;

  @Column({ default: 'pending' })
  status: PostStatus;

  @Column({ nullable: true, type: 'text' })
  error_message: string;

  @Column({ nullable: true })
  sent_at: Date;

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

  /** When set, gallery_json images are composed into collage sheets (this many per sheet) → one album. */
  @Column({ nullable: true, type: 'int' })
  collage_cells: number | null;

  @CreateDateColumn()
  created_at: Date;
}
