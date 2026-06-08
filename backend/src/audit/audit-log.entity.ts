import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export type AuditEventType =
  | 'login_success' | 'login_failed' | 'token_refresh'
  | 'credentials_access' | 'credentials_update'
  | 'sensitive_route_access';

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  user_id: string;

  @Column()
  event_type: AuditEventType;

  @Column({ nullable: true })
  ip_address: string;

  @Column({ nullable: true })
  route: string;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, any>;

  @CreateDateColumn()
  created_at: Date;
}
