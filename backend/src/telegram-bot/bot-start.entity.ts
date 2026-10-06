import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * A reader opening the search bot through one of our links (bot-start.ts). Anonymous, like
 * the search log: which link, and when — never who. The owner's own taps are not recorded.
 */
@Entity('bot_starts')
@Index('idx_bot_starts_user_created', ['user_id', 'created_at'])
export class BotStart {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The account whose bot answered. */
  @Column({ type: 'uuid' })
  user_id: string;

  /** A START_SOURCES key, 'direct' or 'other'. */
  @Column({ type: 'varchar', length: 24 })
  source: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
