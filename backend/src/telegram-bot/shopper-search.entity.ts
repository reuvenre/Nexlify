import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * One search a reader ran in the search bot — what people want, in their own words.
 *
 * The owner asked for the list of what is searched most: it is demand his channels are not
 * yet answering, and the raw material for campaign keywords. Anonymous on purpose: the
 * words and whether anything was found, never who asked. The owner's own test searches are
 * not recorded.
 */
@Entity('shopper_searches')
@Index('idx_shopper_searches_user_created', ['user_id', 'created_at'])
export class ShopperSearch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The account whose bot answered (the admin the search runs as). */
  @Column({ type: 'uuid' })
  user_id: string;

  /** Normalised: lower-case, single spaces, budget words removed. */
  @Column({ type: 'varchar', length: 80 })
  keyword: string;

  @Column({ type: 'float', nullable: true })
  max_price: number | null;

  /** How many products the reader was shown (0 = demand we could not meet). */
  @Column({ type: 'int', default: 0 })
  results: number;

  /** The English search a model wrote when the reader's words found nothing — set only when
   *  that rewrite is what found the results (query-rewrite.ts). */
  @Column({ type: 'varchar', length: 80, nullable: true })
  rewrite: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
