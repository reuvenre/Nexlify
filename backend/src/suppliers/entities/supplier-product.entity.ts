import {
  Entity, PrimaryGeneratedColumn, Column, Index,
  CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { SupplierCatalog } from './supplier-catalog.entity';

export type SupplierProductStatus = 'active' | 'archived';

/**
 * A merged supplier product: real content from Yupoo + the monetizable FLYLINK
 * affiliate link, joined by the canonical SKU. Lives in its own table so it never
 * collides with the AliExpress `catalog_products` flow.
 */
@Entity('supplier_products')
@Index('idx_supplier_products_user_sku', ['user_id', 'sku'])
export class SupplierProduct {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  user_id: string;

  @Column()
  supplier_catalog_id: string;

  @ManyToOne(() => SupplierCatalog, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'supplier_catalog_id' })
  catalog: SupplierCatalog;

  /** Canonical (normalized) product code — the join key. */
  @Column({ nullable: true })
  sku: string;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ nullable: true })
  image_url: string;

  /** JSON array of all gallery image URLs from the Yupoo album. */
  @Column({ type: 'text', nullable: true })
  gallery_json: string;

  @Column('float', { default: 0 })
  price: number;

  @Column({ default: 'USD' })
  currency: string;

  /** Yupoo album URL — re-fetched for content/price sync. */
  @Column({ nullable: true })
  yupoo_url: string;

  /** FLYLINK affiliate link — the monetizable click-through (pasted by the user). */
  @Column({ nullable: true })
  flylink_url: string;

  /** Availability: NULL = never checked; false = FLYLINK link dead / out of stock. */
  @Column({ nullable: true })
  in_stock: boolean;

  @Column({ default: 'active' })
  status: SupplierProductStatus;

  @Column({ default: false })
  has_post: boolean;

  /**
   * When this product was last queued by a FLYLINK campaign. The campaign rotates the
   * catalog by picking the oldest (NULLs = never posted) first, so this is the round-robin
   * cursor. Distinct from has_post (a one-shot "ever posted?" flag).
   */
  @Column({ type: 'timestamptz', nullable: true })
  last_posted_at: Date | null;

  @Column({ nullable: true })
  synced_at: Date;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
