import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

export type RecommendationAgentType = 'site_manager' | 'frontend_architect' | 'backend_architect' | 'security';
export type RecommendationCategory = 'strategy' | 'code_change' | 'security' | 'campaign_action';
export type RecommendationSeverity = 'low' | 'medium' | 'high' | 'critical';
export type RecommendationStatus = 'pending' | 'approved' | 'rejected' | 'applied';

@Entity('agent_recommendations')
export class AgentRecommendation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  user_id: string;

  @Column()
  agent_type: RecommendationAgentType;

  @Column()
  category: RecommendationCategory;

  @Column({ default: 'medium' })
  severity: RecommendationSeverity;

  @Column()
  title: string;

  @Column('text')
  description: string;

  /**
   * Structured proposal data — shape depends on category:
   *  - code_change: { target: 'frontend'|'backend', file_path, diff }
   *  - campaign_action: { action: 'pause'|'resume'|'update_keywords', campaign_id, params }
   *  - strategy / security: free-form supporting data for the human reviewer
   */
  @Column('jsonb', { nullable: true })
  payload: Record<string, any>;

  @Column({ default: 'pending' })
  status: RecommendationStatus;

  @Column({ nullable: true })
  reviewed_at: Date;

  @Column({ nullable: true, type: 'text' })
  review_note: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
