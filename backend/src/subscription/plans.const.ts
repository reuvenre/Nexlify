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

/** Ordered tiers for "plan X and above" checks. */
export const PLAN_ORDER: PlanId[] = ['starter', 'growth', 'autopilot', 'scale'];

/**
 * Feature gating — the MINIMAL plan tier each feature unlocks at. This is the single
 * source of truth for what a subscription actually enforces (matched 1:1 by the
 * pricing pages — never promise a feature here that isn't gated, or vice versa).
 *
 * Tiers are cumulative: a feature at 'growth' is available to growth, autopilot, scale.
 */
export const FEATURE_MIN_PLAN = {
  // ── Publishing platforms ──
  /** Telegram publishing — every tier. */
  platform_telegram: 'starter',
  /** Facebook page publishing (native or via Make relay). */
  platform_facebook: 'growth',
  /** Instagram business publishing. */
  platform_instagram: 'growth',
  /** Pinterest pin publishing. */
  platform_pinterest: 'growth',
  /** WhatsApp group publishing (Green API / Cloud API). */
  platform_whatsapp: 'growth',

  // ── Product sources ──
  /** AliExpress keyword search — every tier. */
  source_aliexpress: 'starter',
  /** Amazon PA-API campaigns. */
  source_amazon: 'autopilot',
  /** Supplier/FLYLINK catalog rotation. */
  source_flylink: 'autopilot',

  // ── Automation depth ──
  /** Multi-agent orchestrator (use_agents campaigns). */
  ai_agents: 'autopilot',
  /** Daily winner-recycling cron. */
  winner_recycling: 'autopilot',
  /** Seasonal commercial-calendar keyword injection. */
  seasonal_calendar: 'autopilot',
  /** Per-campaign send window with its own timezone (US-hours campaigns). */
  campaign_window_tz: 'autopilot',

  // ── Analytics ──
  /** Revenue-attribution report (which post/keyword earns). */
  attribution_report: 'growth',
  /** AI token/budget tracking panel. */
  token_tracking: 'scale',

  // ── Content ──
  /** AI image enhancer. */
  image_enhancer: 'growth',
  /** English/US-audience campaign preset (Pinterest SEO copy, USD pricing). */
  english_campaigns: 'scale',
} as const;

export type FeatureKey = keyof typeof FEATURE_MIN_PLAN;

/** Max WhatsApp connections per tier (0 = platform locked anyway). */
export const WHATSAPP_CONNECTIONS: Record<PlanId, number> = {
  starter: 0, growth: 1, autopilot: 2, scale: 3,
};

/** True when `plan` is at or above the feature's minimal tier. */
export function planAllows(plan: string | null | undefined, feature: FeatureKey): boolean {
  const tier = PLAN_ORDER.indexOf(planOf(plan).id);
  const need = PLAN_ORDER.indexOf(FEATURE_MIN_PLAN[feature] as PlanId);
  return tier >= need;
}

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
