import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, Unique } from 'typeorm';

/**
 * A post as it actually appears in one of the owner's Telegram channels.
 *
 * The posts table is what the system published — but a post can be deleted from the posts
 * screen, edited in Telegram afterwards, or written straight into the channel by hand, and
 * then the readers' search cannot find it there. This table is what the channel itself
 * shows: the bot (an admin of the channel) receives every channel_post / edited_channel_post,
 * and older posts arrive when the owner forwards them to the bot. The readers' search reads
 * both tables (channel-capture.ts).
 */
@Entity('channel_messages')
@Unique('uq_channel_messages_chat_message', ['chat_id', 'message_id'])
@Index('idx_channel_messages_user', ['user_id'])
export class ChannelMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The account that owns the channel (the admin the bot runs as). */
  @Column({ type: 'uuid' })
  user_id: string;

  /** Telegram's numeric chat id (-100…), as a string. */
  @Column({ type: 'varchar', length: 40 })
  chat_id: string;

  /** The channel's public @username, without the @ — builds the t.me link to the post. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  chat_username: string | null;

  @Column({ type: 'int' })
  message_id: number;

  /** The post's text or caption, as the channel shows it. */
  @Column({ type: 'text' })
  text: string;

  /** The first non-Telegram link in the post (hidden behind text or written out). */
  @Column({ type: 'text', nullable: true })
  buy_url: string | null;

  /** When it was posted in the channel (a forward keeps the original date). */
  @Column({ type: 'timestamptz' })
  posted_at: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
