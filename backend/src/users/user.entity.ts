import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  password_hash: string;

  @Column({ nullable: true })
  google_id: string;

  @Column({ nullable: true })
  footer_text: string;

  @Column({ default: 'user' })
  role: 'user' | 'admin';

  @Column({ default: 'free' })
  plan: 'free' | 'starter' | 'growth' | 'autopilot' | 'scale';

  @Column({ nullable: true })
  refresh_token_hash: string;

  @Column({ nullable: true })
  reset_token_hash: string;

  @Column({ nullable: true, type: 'timestamp' })
  reset_token_expires: Date;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
