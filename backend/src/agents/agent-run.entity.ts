import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
} from 'typeorm';

export type AgentType =
  | 'product' | 'content' | 'campaign' | 'orchestrator'
  | 'site_manager' | 'frontend_architect' | 'backend_architect' | 'security';
export type AgentStatus = 'running' | 'completed' | 'failed';

@Entity('agent_runs')
export class AgentRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  user_id: string;

  @Column({ nullable: true })
  campaign_id: string;

  @Column()
  agent_type: AgentType;

  @Column('jsonb', { nullable: true })
  input: Record<string, any>;

  @Column('jsonb', { nullable: true })
  output: Record<string, any>;

  @Column({ default: 0 })
  tokens_used: number;

  @Column({ default: 'running' })
  status: AgentStatus;

  @Column({ nullable: true })
  error_message: string;

  @CreateDateColumn()
  created_at: Date;
}
