import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * Durable destination for a short-link code. Written when a post's /r/<code> link is
 * built, and kept even if the post is later deleted — so a link already printed into a
 * permanent public post (a Facebook ad, a Telegram message) never breaks.
 */
@Entity('link_targets')
export class LinkTarget {
  @PrimaryColumn()
  code: string;

  @Column({ type: 'text' })
  url: string;

  @Column({ type: 'uuid', nullable: true })
  user_id: string | null;

  /** What minted the code when it has no post: null for posts and the storefront,
   *  'shopper' for the members' search bot — so its clicks can be told apart. */
  @Column({ type: 'varchar', length: 20, nullable: true })
  kind: string | null;

  /** Human clicks that resolved through this row (a post's own clicks live on the post). */
  @Column({ type: 'int', default: 0 })
  clicks: number;

  @CreateDateColumn()
  created_at: Date;
}
