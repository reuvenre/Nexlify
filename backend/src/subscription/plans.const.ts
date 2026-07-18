/**
 * Single source of truth for subscription plans.
 * The frontend fetches this via GET /subscription/plans — never hardcode plan
 * numbers in the UI. Prices are in ILS (₪) per month.
 */

export type PlanId = 'starter' | 'growth' | 'autopilot' | 'scale';
export type BillingCycle = 'monthly' | 'annual';

export interface PlanDef {
  id: PlanId;
  name: string;
  price_monthly: number;
  /** Effective monthly price when billed annually. */
  price_annual: number;
  /** Credits granted every month. */
  monthly_credits: number;
  /** Max publishing channels/groups. null = unlimited. */
  max_groups: number | null;
  popular: boolean;
}

// Annual price is the effective monthly cost when billed yearly — a ~20% discount off the
// monthly price, rounded to the nearest shekel.
export const PLANS: Record<PlanId, PlanDef> = {
  starter: {
    id: 'starter', name: 'Starter',
    price_monthly: 69, price_annual: 55,
    monthly_credits: 1500, max_groups: 1, popular: false,
  },
  growth: {
    id: 'growth', name: 'Growth',
    price_monthly: 150, price_annual: 120,
    monthly_credits: 5000, max_groups: 5, popular: true,
  },
  autopilot: {
    id: 'autopilot', name: 'Autopilot',
    price_monthly: 220, price_annual: 176,
    monthly_credits: 7000, max_groups: 10, popular: false,
  },
  scale: {
    id: 'scale', name: 'Scale',
    price_monthly: 449, price_annual: 359,
    monthly_credits: 50000, max_groups: null, popular: false,
  },
};

export const DEFAULT_PLAN: PlanId = 'starter';

/** How many credits each billable action costs. */
export const CREDIT_COSTS = {
  /** One AI text generation (post copy). */
  ai_generate: 5,
  /** One post published (regardless of how many platforms it fans out to). */
  publish: 10,
} as const;

export function planOf(id: string | null | undefined): PlanDef {
  return PLANS[(id as PlanId) || DEFAULT_PLAN] || PLANS[DEFAULT_PLAN];
}
