import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

/**
 * An append-only audit record of a security-relevant action. The watchdog scans
 * these for anomalies (brute-force, privilege escalation, …); the admin screen
 * lists them. Never updated after insert.
 */
export type SecurityEventType =
  | 'login_failed'
  | 'login_success'
  | 'password_reset_requested'
  | 'role_changed'
  | 'admin_created'
  | 'decrypt_failed';

@Entity('security_events')
@Index('idx_secevent_type_time', ['type', 'created_at'])
export class SecurityEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  type: SecurityEventType;

  /** The account the event concerns (login email, target of a role change). Not a FK —
   *  a failed login may reference an email that doesn't exist. */
  @Column({ type: 'varchar', nullable: true })
  email: string | null;

  /** Affected/acting user id when known. */
  @Column({ type: 'varchar', nullable: true })
  user_id: string | null;

  /** Best-effort client IP (X-Forwarded-For first hop). */
  @Column({ type: 'varchar', nullable: true })
  ip: string | null;

  /** Free-form context (e.g. "user→admin", actor id). Never store secrets here. */
  @Column({ type: 'varchar', nullable: true })
  detail: string | null;

  @CreateDateColumn()
  @Index('idx_secevent_time')
  created_at: Date;
}
