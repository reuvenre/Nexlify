import {
  Entity, PrimaryGeneratedColumn, Column, Index,
  CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

export type SkuMatchMode = 'exact' | 'numeric' | 'prefix_map' | 'regex';

/**
 * A user-managed supplier catalog: a content source (Yupoo store) paired with an
 * affiliate network (FLYLINK), plus the per-catalog rule that matches the product
 * code between the two sites. Kept fully separate from the AliExpress catalog.
 */
@Entity('supplier_catalogs')
@Index('idx_supplier_catalogs_user', ['user_id'])
export class SupplierCatalog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  user_id: string;

  @Column()
  name: string;

  /** Content source. Only 'yupoo' today; kept open for future sources. */
  @Column({ default: 'yupoo' })
  source_type: string;

  /** Yupoo store slug, e.g. 'seppuyukeji' (from {slug}.x.yupoo.com). */
  @Column({ nullable: true })
  source_store: string;

  /** Affiliate network the pasted link belongs to. */
  @Column({ default: 'flylink' })
  affiliate_network: string;

  /** How the source code is matched to the affiliate code. */
  @Column({ default: 'numeric' })
  sku_match_mode: SkuMatchMode;

  /** Mode config, e.g. { source_prefix:'LUN', affiliate_prefix:'LN' } or { pattern:'...' }. */
  @Column({ type: 'jsonb', nullable: true })
  sku_match_config: Record<string, any>;

  /** Optional CSS/parse selector overrides merged over the built-in Yupoo defaults. */
  @Column({ type: 'text', nullable: true })
  selectors_json: string;

  /** Default Telegram publishing group (chat id) for products from this catalog. */
  @Column({ nullable: true })
  target_channel_id: string;

  /** Reserved for a future authenticated FLYLINK API (encrypted). */
  @Column({ nullable: true })
  flylink_api_token_enc: string;

  @Column({ default: true })
  enabled: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
