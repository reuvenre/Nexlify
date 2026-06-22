import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn,
  ManyToOne, JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

export type AdBoostStatus = 'boosted' | 'skipped' | 'failed';

/**
 * One performance-evaluation record per published Facebook post. When ROAS (or
 * a strong organic-click signal) clears the user's threshold, a Meta Ads creative
 * is created and the row is marked 'boosted'. Ported from NEXUS's Performance agent.
 */
@Entity('ad_boosts')
export class AdBoost {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  user_id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ nullable: true })
  post_id: string;

  @Column({ nullable: true })
  facebook_post_id: string;

  @Column({ nullable: true })
  product_title: string;

  @Column({ type: 'int', default: 0 })
  clicks: number;

  @Column({ type: 'int', default: 0 })
  impressions: number;

  @Column('float', { default: 0 })
  roas: number;

  @Column('float', { default: 0 })
  ad_spend: number;

  @Column('float', { default: 0 })
  daily_budget: number;

  @Column({ default: 'skipped' })
  status: AdBoostStatus;

  /** Meta Ads creative id once a boost is created */
  @Column({ nullable: true })
  creative_id: string;

  @Column({ nullable: true, type: 'text' })
  note: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
