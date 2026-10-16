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

  /**
   * JSON array of the album's videos, `{ url, thumb }` (see yupoo-video.ts). Yupoo albums
   * mix photos and videos; only the photos used to come through. Refreshed by the sync.
   */
  @Column({ type: 'text', nullable: true })
  videos_json: string | null;

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
   * Owner opt-out from the FLYLINK campaign rotation: the autopilot never publishes this
   * product on its own. Manual send/schedule/queue stay fully available — the owner keeps
   * hand-picking where such a product goes (e.g. a Takti-only item the mama campaign must
   * not re-post to its own group).
   */
  @Column({ default: false })
  no_auto_post: boolean;

  /**
   * When this product was last queued by a FLYLINK campaign. The campaign rotates the
   * catalog by picking the oldest (NULLs = never posted) first, so this is the round-robin
   * cursor. Distinct from has_post (a one-shot "ever posted?" flag).
   */
  @Column({ type: 'timestamptz', nullable: true })
  last_posted_at: Date | null;

  /**
   * What this product is CALLED in the public store, as opposed to how it is filed.
   *
   * The album title is written for the warehouse and the only thing that reliably says
   * what the product IS is the photograph, so an agent looks at the photo once and writes
   * these three down. Separate from title/description on purpose: the original is the key
   * that matches the album back to the seller's catalog on every re-sync.
   *
   * All three are freely editable by the owner — the agent proposes, he decides.
   */
  @Column({ type: 'text', nullable: true })
  store_name: string | null;

  @Column({ type: 'text', nullable: true })
  store_category: string | null;

  @Column({ type: 'text', nullable: true })
  store_brand: string | null;

  /**
   * When the agent last looked at this product. NULL is its work queue.
   *
   * Set even when the agent could not decide, so a product it failed on is not retried
   * forever — and it is what keeps the agent off a product the owner has corrected.
   */
  @Column({ type: 'timestamptz', nullable: true })
  store_enriched_at: Date | null;

  /**
   * Off the public shelf, and nothing else.
   *
   * Distinct from every neighbouring switch on purpose: `status` also drops the product
   * from the campaign rotation, `no_auto_post` stops the autopilot but leaves it in the
   * shop, and deleting loses the hand-generated FLYLINK link for good. This is the one
   * that means only "not this one, in the shop".
   */
  @Column({ default: false })
  store_hidden: boolean;

  @Column({ nullable: true })
  synced_at: Date;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
