import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, Unique } from 'typeorm';

/**
 * A reader's «תודיע לי כשהמחיר יורד» on one product (price-alerts.ts).
 *
 * Unlike the search log this cannot be anonymous: the whole point is to message the reader
 * back, so it keeps their private chat id — and only that. It is dropped when the alert fires,
 * after ALERT_TTL_DAYS, when the product disappears, when the reader blocks the bot, or when
 * they ask (/stop).
 */
@Entity('price_alerts')
@Unique('uq_price_alerts_chat_product', ['chat_id', 'product_id'])
@Index('idx_price_alerts_active', ['active', 'user_id'])
export class PriceAlert {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The account whose bot and AliExpress keys serve the alert. */
  @Column({ type: 'uuid' })
  user_id: string;

  /** The reader's private chat with the bot. */
  @Column({ type: 'varchar', length: 40 })
  chat_id: string;

  @Column({ type: 'varchar', length: 40 })
  product_id: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text', nullable: true })
  image_url: string | null;

  /** The price the reader saw when they tapped the bell — the bar a drop is measured from. */
  @Column({ type: 'float' })
  price_ils: number;

  @Column({ type: 'varchar', length: 8, default: 'ILS' })
  currency: string;

  @Column({ default: true })
  active: boolean;

  /** Checks in a row the API did not return the product. */
  @Column({ type: 'int', default: 0 })
  misses: number;

  @Column({ type: 'timestamptz', nullable: true })
  checked_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  notified_at: Date | null;

  @Column({ type: 'float', nullable: true })
  notified_price: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
