'use client';

import { Star, ShoppingBag, CheckCircle2 } from 'lucide-react';
import type { AliProduct } from '@/types';

const SYMBOLS: Record<string, string> = { ILS: '₪', EUR: '€', GBP: '£', USD: '$' };

interface ProductCardProps {
  product: AliProduct;
  onSelect: (product: AliProduct) => void;
  isSelected?: boolean;
}

function formatOrders(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function ProductCard({ product, onSelect, isSelected }: ProductCardProps) {
  const sym  = SYMBOLS[product.currency] || '$';
  const fmt  = (v: number) =>
    v.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

  const hasDiscount = product.original_price > product.sale_price && product.discount_percent > 0;
  const rating = Math.min(Math.max(product.rating || 0, 0), 5);

  return (
    <div
      onClick={() => onSelect(product)}
      role="button"
      tabIndex={0}
      aria-pressed={!!isSelected}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(product); } }}
      className={`group relative cursor-pointer rounded-xl overflow-hidden transition-all duration-300
        ${isSelected
          ? 'ring-2 ring-blue-500 ring-offset-1 ring-offset-surface-primary bg-blue-500/5 border border-blue-500/30'
          : 'border border-edge bg-surface-secondary hover:border-edge-hover hover:bg-surface-tertiary hover:-translate-y-0.5 hover:shadow-[0_18px_38px_-20px_rgba(0,0,0,0.55)]'
        }`}
      style={{ boxShadow: isSelected ? '0 0 0 1px rgba(59,130,246,0.3), 0 4px 16px rgba(59,130,246,0.08)' : undefined }}
    >
      {/* Discount badge */}
      {hasDiscount && (
        <div className="absolute top-2 right-2 z-10 bg-gradient-to-br from-rose-500 to-red-600 text-white text-2xs font-bold px-1.5 py-0.5 rounded-md shadow-[0_4px_12px_-2px_rgba(244,63,94,0.5)] tracking-wide">
          -{product.discount_percent}%
        </div>
      )}

      {/* Selected checkmark */}
      {isSelected && (
        <div className="absolute top-2 left-2 z-10">
          <CheckCircle2 size={18} className="text-blue-400 drop-shadow-md" fill="rgba(59,130,246,0.2)" />
        </div>
      )}

      {/* Image */}
      <div className="relative aspect-square bg-white/[0.04] overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={product.image_url}
          alt=""
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
          loading="lazy"
        />
        <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-black/20 to-transparent pointer-events-none" />
      </div>

      {/* Info */}
      <div className="p-3">
        <p className="text-xs text-white/75 line-clamp-2 leading-[1.45] mb-2.5 min-h-[2.2rem]">
          {product.title}
        </p>

        {/* Prices */}
        <div className="flex items-baseline gap-2 mb-1.5">
          <span className="text-sm font-bold text-white tracking-tight">
            {sym}{fmt(product.sale_price)}
          </span>
          {hasDiscount && (
            <span className="text-xs text-white/30 line-through">
              {sym}{fmt(product.original_price)}
            </span>
          )}
        </div>

        {/* USD hint */}
        {product.sale_price_usd !== undefined && product.currency !== 'USD' && (
          <p className="text-2xs text-white/20 mb-1.5">${product.sale_price_usd.toFixed(2)} USD</p>
        )}

        {/* Stats */}
        <div className="flex items-center justify-between text-2xs text-white/30 mt-1">
          <span className="flex items-center gap-0.5">
            <Star size={9} className="text-amber-400 fill-amber-400 shrink-0" />
            <span className="text-white/55 font-medium">{rating.toFixed(1)}</span>
          </span>
          <span className="flex items-center gap-0.5">
            <ShoppingBag size={9} className="shrink-0" />
            {formatOrders(product.orders_count)}
          </span>
        </div>
      </div>
    </div>
  );
}
