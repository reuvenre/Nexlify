import {
  Entity, PrimaryGeneratedColumn, Column, Index, Unique,
  CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

/** bigint columns come back as strings from pg — coerce to number for the API. */
const bigintToNum = {
  to: (v?: number) => v ?? 0,
  from: (v?: string | number | null) => (v == null ? 0 : typeof v === 'number' ? v : parseInt(v, 10) || 0),
};

/**
 * Per-day, per-provider AI token consumption for a user. One row per
 * (user_id, day, provider); token columns are incremented on every AI call.
 * `day` is a calendar date string (YYYY-MM-DD) in the user's local timezone
 * (Asia/Jerusalem) so "usage 00:00–23:59" lines up with what the user sees.
 */
@Entity('ai_usage')
@Unique('uq_ai_usage_user_day_provider', ['user_id', 'day', 'provider'])
export class AiUsage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  user_id: string;

  /** Calendar day in Asia/Jerusalem, e.g. "2026-07-13". */
  @Column({ type: 'date' })
  day: string;

  /** 'gemini' | 'anthropic' | 'openai' */
  @Column({ default: 'gemini' })
  provider: string;

  @Column({ type: 'bigint', default: 0, transformer: bigintToNum })
  prompt_tokens: number;

  @Column({ type: 'bigint', default: 0, transformer: bigintToNum })
  output_tokens: number;

  @Column({ type: 'bigint', default: 0, transformer: bigintToNum })
  total_tokens: number;

  @Column({ type: 'int', default: 0 })
  calls: number;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
