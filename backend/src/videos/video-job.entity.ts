import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * One product Reel: requested for a sent post, rendered on GitHub Actions (video-renderer/),
 * published to Instagram and Facebook Reels (reel-spec.ts, videos.service.ts).
 *
 * The MP4 itself sits in `video` only until Meta has pulled it: Instagram and Facebook take a
 * Reel by URL, and this table is the one place the backend can serve it from without a
 * storage service. It is cleared a few days after publishing; the row stays as history.
 */
@Entity('video_jobs')
@Index('idx_video_jobs_post', ['post_id'])
@Index('idx_video_jobs_status', ['status'])
export class VideoJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'uuid' })
  post_id: string;

  /** queued → (generating: the AI clip) → rendering → ready → published | failed */
  @Column({ type: 'varchar', length: 16, default: 'queued' })
  status: string;

  /** Who asked: 'auto' (the daily pick) or 'owner' (/reel). */
  @Column({ type: 'varchar', length: 16, default: 'auto' })
  origin: string;

  /** The composition input the renderer fetches (reel-spec.ts). */
  @Column({ type: 'jsonb' })
  spec: any;

  /** Capability for the renderer: fetch the spec, post the result. */
  @Column({ type: 'varchar', length: 64 })
  worker_token: string;

  /** Capability for Meta: fetch the finished MP4. */
  @Column({ type: 'varchar', length: 64 })
  media_token: string;

  @Column({ type: 'bytea', nullable: true, select: false })
  video: Buffer | null;

  /** The AI opening clip (ai-clip.ts), held until the renderer has fetched it. */
  @Column({ type: 'bytea', nullable: true, select: false })
  clip: Buffer | null;

  /** What the Reel opened with, as the renderer reports it: seller | ai | none. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  clip_source: string | null;

  @Column({ type: 'int', nullable: true })
  video_size: number | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  instagram_media_id: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  facebook_video_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  rendered_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  published_at: Date | null;
}
