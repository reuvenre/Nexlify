import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, ManyToOne, JoinColumn, Unique, Index,
} from 'typeorm';
import { User } from '../users/user.entity';

export type EarningStatus = 'estimated' | 'settled' | 'cancelled';

@Entity('earnings')
// One row per (user, order) — prevents duplicate money rows from concurrent syncs.
@Unique('uq_earnings_user_order', ['user_id', 'order_id'])
@Index('idx_earnings_user_date', ['user_id', 'order_date'])
export class Earning {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  user_id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ nullable: true })
  campaign_id: string;

  /** The post that drove this commission (attribution: same product, published before
   *  the order in a 30-day window; most-clicked post wins). null = not yet matched. */
  @Column({ type: 'uuid', nullable: true })
  post_id: string | null;

  /** Search keyword inherited from the attributed post — powers the money-per-keyword report. */
  @Column({ nullable: true, type: 'varchar' })
  keyword: string | null;

  @Column()
  order_id: string;

  @Column()
  product_id: string;

  @Column('float', { default: 0 })
  order_amount_usd: number;

  @Column('float', { default: 0 })
  commission_usd: number;

  @Column('float', { default: 0 })
  commission_ils: number;

  @Column({ default: 'estimated' })
  status: EarningStatus;

  @Column()
  order_date: Date;

  /** When the buyer's payment completed — the date basis the AliExpress portal's
   *  "Completed Payments Time" filter uses, so counts here can match it 1:1. */
  @Column({ type: 'timestamptz', nullable: true })
  paid_date: Date | null;

  @Column({ nullable: true })
  settlement_date: Date;

  @CreateDateColumn()
  created_at: Date;
}
