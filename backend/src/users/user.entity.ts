import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  password_hash: string;

  /** Access role: 'user' (default) or 'admin' (can view all users) */
  @Column({ default: 'user' })
  role: string;

  @Column({ nullable: true })
  google_id: string;

  @Column({ nullable: true })
  footer_text: string;

  @Column({ nullable: true })
  refresh_token_hash: string;

  @Column({ nullable: true })
  reset_token_hash: string;

  @Column({ nullable: true, type: 'timestamp' })
  reset_token_expires: Date;

  // ── Two-factor auth (TOTP) ────────────────────────────────────────────────
  /** AES-encrypted base32 TOTP secret. Present once setup starts; active only when enabled. */
  @Column({ nullable: true })
  totp_secret_enc: string;

  /** True once the user has confirmed a code — login then requires a 2FA step. */
  @Column({ default: false })
  totp_enabled: boolean;

  // ── Subscription (demo-mode billing — no payment gateway yet) ──────────────
  // Plan numbers (credits/limits/prices) live in subscription/plans.const.ts;
  // only the user's state is stored here.

  /** Active plan id: 'starter' | 'growth' | 'autopilot' | 'scale' */
  @Column({ default: 'starter' })
  subscription_plan: string;

  /** 'monthly' | 'annual' — affects displayed price only (demo mode). */
  @Column({ default: 'monthly' })
  plan_billing: string;

  /** Current credit balance; refilled to the plan's monthly amount each cycle. */
  @Column({ type: 'int', default: 500 })
  credits_remaining: number;

  /** When the next monthly credit refill happens (lazy — applied on first use after). */
  @Column({ nullable: true, type: 'timestamp' })
  plan_renews_at: Date;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
