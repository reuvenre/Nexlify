import {
  Entity, PrimaryGeneratedColumn, Column, Index,
  CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

export type CustomPostRepeat = 'none' | 'daily' | 'weekly';

/**
 * A user-authored scheduled post ("special post"): fixed content the user writes up front,
 * sent to chosen groups at a chosen time, optionally recurring. On dispatch it's placed into
 * each target group's NEXT free queue slot (via nextGroupSlot), so it interleaves with the
 * autopilot posts on the same one-per-interval clock instead of colliding.
 */
@Entity('custom_posts')
@Index('idx_custom_posts_user', ['user_id'])
export class CustomPost {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  user_id: string;

  /** A label for the user's list — not published. */
  @Column({ default: '' })
  name: string;

  /** The exact text to publish (Telegram-style HTML allowed, same as other posts). */
  @Column({ type: 'text' })
  body: string;

  /** Image URLs to attach (JSON array). Empty → text-only post. */
  @Column({ type: 'jsonb', nullable: true })
  image_urls: string[] | null;

  /** Target group channel_ids (JSON array). One scheduled post is created per group. */
  @Column({ type: 'jsonb', nullable: true })
  target_channels: string[] | null;

  /** Earliest time to send. The real send lands in the group's next free slot at/after this. */
  @Column({ type: 'timestamptz' })
  send_at: Date;

  @Column({ default: 'none' })
  repeat: CustomPostRepeat;

  @Column({ default: true })
  enabled: boolean;

  /** Cron cursor — when the next dispatch is due. Advanced by `repeat` after each send. */
  @Column({ type: 'timestamptz', nullable: true })
  next_send_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  last_sent_at: Date | null;

  @Column({ default: 0 })
  sent_count: number;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
