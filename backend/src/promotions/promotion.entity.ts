import {
  Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';

/**
 * An admin-managed sale on subscription plans or credit packs. Active window is
 * date-driven (starts_at..ends_at) so promotions turn themselves on and off —
 * no code deploys. Discount is EITHER percent_off OR a fixed price, per target.
 */
@Entity('promotions')
export class Promotion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Banner headline shown on /pricing and the subscription screen. */
  @Column()
  title: string;

  /** What the promo applies to: 'plan' (one plan), 'all_plans', or 'packs'. */
  @Column({ default: 'plan' })
  target_type: string;

  /** Plan id (starter/growth/autopilot/scale) or pack id — when target_type='plan'/'packs'. Null for all_plans. */
  @Column({ type: 'varchar', nullable: true })
  target_id: string | null;

  /** Percent off the regular price (1–90). Mutually exclusive with fixed_price. */
  @Column({ type: 'int', nullable: true })
  percent_off: number | null;

  /** Fixed promo price in ILS. Mutually exclusive with percent_off. */
  @Column({ type: 'int', nullable: true })
  fixed_price: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  starts_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  ends_at: Date | null;

  /** Kill switch — a promo can be drafted/paused without deleting it. */
  @Column({ default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
