import type { ActiveDeal } from '@/types';

/** The deal that applies to a plan (specific beats all-plans) or a credit pack. */
export function dealFor(
  deals: ActiveDeal[], kind: 'plan' | 'pack', id: string,
): ActiveDeal | null {
  if (kind === 'plan') {
    return deals.find((d) => d.target_type === 'plan' && d.target_id === id)
      || deals.find((d) => d.target_type === 'all_plans')
      || null;
  }
  return deals.find((d) => d.target_type === 'packs' && (!d.target_id || d.target_id === id)) || null;
}

/** Promo price for a base price (whole ILS). */
export function dealPrice(base: number, deal: ActiveDeal): number {
  if (deal.fixed_price != null) return deal.fixed_price;
  if (deal.percent_off != null) return Math.round(base * (1 - deal.percent_off / 100));
  return base;
}

/** "נגמר בעוד X ימים/שעות" — urgency line for a deal's end date. */
export function endsInLabel(endsAt: string | null): string | null {
  if (!endsAt) return null;
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return null;
  const hours = Math.ceil(ms / 3_600_000);
  if (hours <= 48) return `נגמר בעוד ${hours} שעות`;
  return `נגמר בעוד ${Math.ceil(hours / 24)} ימים`;
}
