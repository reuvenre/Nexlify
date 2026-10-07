import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, Unique } from 'typeorm';

/**
 * A reader following one parcel (parcel-tracking.ts). Like a price alert it keeps the
 * reader's private chat id — it has to message them back — and the tracking number, and
 * nothing else. It goes inactive on delivery, after PARCEL_TTL_DAYS, on 🔕, or when the
 * reader blocks the bot; inactive rows are deleted after 30 days.
 */
@Entity('parcel_tracks')
@Unique('uq_parcel_tracks_chat_number', ['chat_id', 'number'])
@Index('idx_parcel_tracks_active', ['active'])
export class ParcelTrack {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The account whose bot serves the reader. */
  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'varchar', length: 40 })
  chat_id: string;

  @Column({ type: 'varchar', length: 40 })
  number: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  status: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  sub_status: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  event_time: Date | null;

  @Column({ default: true })
  active: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  checked_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  notified_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
