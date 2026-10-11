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

  /**
   * When the token above dies, per Graph. Null = unknown (never resolved, or a token that
   * does not expire) and must never be read as "expired" — see meta-token.ts.
   *
   * This existed for the account-level token and not for these, so a group token could
   * lapse in silence and take that group's Facebook and Instagram publishing with it.
   */
  @Column({ nullable: true, type: 'timestamp' })
  facebook_token_expires_at: Date | null;

  /** Last time the owner was emailed about THIS token expiring — throttles the re-nag and
   *  is cleared whenever a fresh token is saved. */
  @Column({ nullable: true, type: 'timestamp' })
  facebook_token_notified_at: Date | null;

  /**
   * Instagram Business account id for THIS group. A second brand has its own Instagram,
   * and the account-wide id can only ever point at one of them — so a post routed here
   * publishes to this group's account. Null → the user's global Instagram.
   *
   * Publishing uses the Page token from the SAME group (an Instagram Business account is
   * reached through the Facebook Page it is linked to), which is why the two are set
   * together rather than independently.
   */
  @Column({ nullable: true })
  instagram_business_id: string;

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

  /**
   * OPT-IN smart timing: when true, the scheduler nudges this group's posts into its
   * learned golden hours (the hours its audience actually clicks — see optimizer's
   * hot-hours). Default false: the owner flips this knowingly, per group — timing behaviour
   * must never change behind their back.
   */
  @Column({ type: 'boolean', default: false })
  smart_timing: boolean;

  /**
   * The group's core focus, in the owner's words ("ציוד טקטי ואיירסופט: נרתיקים, אפודים…").
   * Null = no focus: products go through the lenient relevance guard only (reject a clear
   * misfit). Set = every automatic route into this group publishes ONLY products clearly
   * inside it — see posts/group-focus.ts.
   */
  @Column({ type: 'text', nullable: true })
  core_focus: string | null;

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
