import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

@Entity('channels')
export class Channel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  user_id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column()
  name: string;

  @Column({ default: 'telegram' })
  platform: string;

  @Column({ nullable: true })
  bot_token_enc: string;

  @Column({ nullable: true })
  channel_id: string;

  @Column({ nullable: true })
  description: string;

  // Per-channel body + footer template (each group can have its own copy style and its
  // own join link). Fall back to the user's global defaults when null.
  // body_template_id is varchar (built-in templates use string ids like 'builtin_default').
  @Column({ type: 'varchar', nullable: true })
  body_template_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  footer_template_id: string | null;

  /** Facebook Page id for THIS group — a post routed here publishes to its own page
   *  (via the Make relay or native Graph). Null → the user's global default page. */
  @Column({ nullable: true })
  facebook_page_id: string;

  @Column({ default: true })
  is_active: boolean;

  @Column({ type: 'int', default: 0, nullable: true })
  members_count: number;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
