import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index,
} from 'typeorm';
import { User } from '../users/user.entity';

/**
 * An AliExpress coupon tier, e.g. "ILAFF3 — $7 OFF $55+".
 * Coupons come in tiers keyed by a minimum spend, so each product gets the single best
 * coupon it qualifies for. They are campaign-scoped and EXPIRE — outside
 * [starts_at, ends_at] they are never attached to a post.
 */
@Entity('coupons')
@Index(['user_id', 'min_spend_usd'])
export class Coupon {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  user_id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** The code the buyer types at checkout, e.g. "ILAFF3". */
  @Column()
  code: string;

  /** Discount in USD ($7 in "$7 OFF $55+"). */
  @Column('float', { default: 0 })
  discount_usd: number;

  /** Minimum order value in USD ($55 in "$7 OFF $55+"). */
  @Column('float', { default: 0 })
  min_spend_usd: number;

  /** Free-text campaign label, e.g. "IL [Vacation Sale]" — for grouping in the UI. */
  @Column({ nullable: true })
  campaign: string;

  /** Validity window. Outside it the coupon is never attached. */
  @Column({ type: 'timestamp', nullable: true })
  starts_at: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  ends_at: Date | null;

  /** Manual kill switch, independent of the date window. */
  @Column({ default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;
}
