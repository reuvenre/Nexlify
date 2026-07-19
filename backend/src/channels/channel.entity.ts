import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

@Entity('channels')
export class Channel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  user_id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column()
  name: string;

  @Column({ default: 'telegram' })
  platform: string;

  @Column({ nullable: true })
  bot_token_enc: string;

  @Column({ nullable: true })
  channel_id: string;

  @Column({ nullable: true })
  description: string;

  // Per-channel body + footer template (each group can have its own copy style and its
  // own join link). Fall back to the user's global defaults when null.
  // body_template_id is varchar (built-in templates use string ids like 'builtin_default').
  @Column({ type: 'varchar', nullable: true })
  body_template_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  footer_template_id: string | null;

  /** Facebook Page id for THIS group — a post routed here publishes to its own page
   *  (via the Make relay or native Graph). Null → the user's global default page. */
  @Column({ nullable: true })
  facebook_page_id: string;

  /** Page Access Token for THIS group's Facebook page (encrypted). Each page needs its own
   *  token, so a group on a different page carries its own. Null → the account's global token. */
  @Column({ nullable: true })
  facebook_page_token_enc: string;

  @Column({ default: true })
  is_active: boolean;

  // ── Per-group send queue ───────────────────────────────────────────────────
  // Each group has its OWN queue and its OWN clock, so one group's posts can't eat
  // another's slots. Every field is nullable = "inherit the user's global schedule".

  /** null → inherit the user's global schedule_enabled. */
  @Column({ type: 'boolean', nullable: true })
  schedule_enabled: boolean | null;

  /** Minutes between posts for THIS group. null → inherit global. */
  @Column({ type: 'int', nullable: true })
  schedule_interval_minutes: number | null;

  /** Send-window start hour (Asia/Jerusalem). null → inherit global. */
  @Column({ type: 'int', nullable: true })
  schedule_start_hour: number | null;

  /** Send-window end hour (exclusive). null → inherit global. */
  @Column({ type: 'int', nullable: true })
  schedule_end_hour: number | null;

  /** When this group last received a queued post — its own interval clock. */
  @Column({ type: 'timestamp', nullable: true })
  schedule_last_sent_at: Date | null;

  /** When this group's Facebook PAGE last received a post — the FB throttle clock, kept
   *  separate from the Telegram queue clock so Facebook can be paced independently. */
  @Column({ type: 'timestamp', nullable: true })
  facebook_last_sent_at: Date | null;

  @Column({ type: 'int', default: 0, nullable: true })
  members_count: number;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
