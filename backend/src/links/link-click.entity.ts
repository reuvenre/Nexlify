import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, Index,
} from 'typeorm';

/**
 * One row per click on a post's trackable short link (/r/<code>). This is the
 * fast feedback signal — clicks arrive within minutes of publishing, commissions
 * only days later — and the weighting input for revenue attribution.
 */
@Entity('link_clicks')
@Index('idx_link_clicks_post', ['post_id'])
@Index('idx_link_clicks_user_date', ['user_id', 'clicked_at'])
export class LinkClick {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  post_id: string;

  @Column()
  user_id: string;

  @Column({ nullable: true })
  referrer: string;

  @Column({ nullable: true })
  user_agent: string;

  @CreateDateColumn()
  clicked_at: Date;
}
