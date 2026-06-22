import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

export type CatalogStatus = 'pending' | 'approved' | 'rejected';

@Entity('catalog_products')
export class CatalogProduct {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  user_id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** AliExpress product ID */
  @Column()
  product_id: string;

  @Column({ type: 'text' })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column('float', { default: 0 })
  original_price: number;

  @Column('float', { default: 0 })
  sale_price: number;

  @Column({ default: 'ILS' })
  currency: string;

  @Column('int', { default: 0 })
  discount_percent: number;

  @Column({ type: 'text', nullable: true })
  image_url: string;

  @Column({ type: 'text', nullable: true })
  product_url: string;

  @Column({ type: 'text', nullable: true })
  affiliate_url: string;

  @Column({ nullable: true })
  category: string;

  @Column({ nullable: true })
  keyword: string;

  @Column('int', { default: 0 })
  orders_count: number;

  @Column('float', { default: 0 })
  rating: number;

  @Column({ nullable: true })
  coupon_code: string;

  @Column('float', { default: 0 })
  commission_rate: number;

  @Column('float', { default: 0 })
  evaluation_rate: number;

  @Column({ default: 'pending' as CatalogStatus })
  status: CatalogStatus;

  @Column({ default: 'AliExpress' })
  supplier: string;

  @Column({ default: false })
  has_post: boolean;

  /** Result of the last affiliate-link health check (null = never checked) */
  @Column({ nullable: true, type: 'boolean' })
  link_validated: boolean;

  @Column({ nullable: true, type: 'timestamp' })
  synced_at: Date;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
