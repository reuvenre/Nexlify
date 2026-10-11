/**
 * Single source of truth for subscription plans.
 * The frontend fetches this via GET /subscription/plans — never hardcode plan
 * numbers in the UI. Prices are in ILS (₪) per month.
 */

export type PlanId = 'free' | 'starter' | 'growth' | 'autopilot' | 'scale';
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
  free: {
    id: 'free', name: 'חינם',
    price_monthly: 0, price_annual: 0,
    /**
     * 450 credits ≈ ONE POST A DAY for a month (a post costs 15: 5 to write, 10 to publish).
     *
     * It was 100 — about six posts, total. This product's value is what happens over TIME:
     * the autopilot runs unattended, the rotation learns, clicks accumulate. None of that
     * is visible in six posts, and at a small group's click rate a free user was likely to
     * see ZERO clicks before deciding the thing does not work. A daily post for a month
     * crosses that threshold, which is the only job this tier has.
     *
     * Still one group, still Telegram + AliExpress only: the ceiling is what converts.
     */
    monthly_credits: 450, max_groups: 1, popular: false,
  },
  starter: {
    id: 'starter', name: 'Starter',
    price_monthly: 89, price_annual: 71,
    monthly_credits: 1500, max_groups: 1, popular: false,
  },
  growth: {
    id: 'growth', name: 'Growth',
    price_monthly: 199, price_annual: 159,
    monthly_credits: 5000, max_groups: 5, popular: true,
  },
  autopilot: {
    id: 'autopilot', name: 'Autopilot',
    price_monthly: 275, price_annual: 220,
    monthly_credits: 7000, max_groups: 10, popular: false,
  },
  scale: {
    id: 'scale', name: 'Scale',
    price_monthly: 449, price_annual: 359,
    monthly_credits: 50000, max_groups: null, popular: false,
  },
};

export const DEFAULT_PLAN: PlanId = 'free';

/** Ordered tiers for "plan X and above" checks. */
export const PLAN_ORDER: PlanId[] = ['free', 'starter', 'growth', 'autopilot', 'scale'];

// ── Free trial ────────────────────────────────────────────────────────────────
/**
 * Every new account opens every FEATURE gate for two weeks.
 *
 * The reason it unlocks features and not credits: what is impressive here — the agents,
 * the nightly optimizer, the seasonal calendar, publishing to five platforms at once — all
 * sits at Autopilot. A free user on Telegram alone never feels any of it, so however many
 * posts you give them, the expensive tiers stay abstract. Volume is what a subscription
 * buys; INTELLIGENCE is what a trial has to demonstrate.
 *
 * Deliberately NOT extended to credits or group count. The trial account keeps the free
 * tier's 450 credits and its single group, which means nothing has to be taken away when
 * the trial ends: no orphaned channels, no balance to claw back, no cleanup job. The gates
 * simply close again, and the user has by then seen exactly what closing them costs.
 */
export const TRIAL_DAYS = 14;
/** The tier a trial gates at. */
export const TRIAL_PLAN: PlanId = 'autopilot';

/** When a trial started now would end. */
export function trialEndsAt(from: Date = new Date()): Date {
  return new Date(from.getTime() + TRIAL_DAYS * 24 * 3600_000);
}

/**
 * The tier to CHECK FEATURES against: the user's own plan, or the trial tier while a trial
 * is running — whichever is higher.
 *
 * "Whichever is higher" matters: a Scale customer inside their first two weeks must not be
 * demoted to Autopilot by their own trial.
 */
export function effectivePlan(
  plan: string | null | undefined, trial_ends_at: Date | string | null | undefined,
  now: Date = new Date(),
): PlanId {
  const own = planOf(plan).id;
  if (!trial_ends_at) return own;
  const ends = new Date(trial_ends_at).getTime();
  if (!Number.isFinite(ends) || ends <= now.getTime()) return own;
  return PLAN_ORDER.indexOf(TRIAL_PLAN) > PLAN_ORDER.indexOf(own) ? TRIAL_PLAN : own;
}

/** Whole days left in a running trial; 0 when none is running. Rounded UP, because a
 *  banner saying "0 ימים" on the last afternoon reads as already expired. */
export function trialDaysLeft(
  trial_ends_at: Date | string | null | undefined, now: Date = new Date(),
): number {
  if (!trial_ends_at) return 0;
  const ms = new Date(trial_ends_at).getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.ceil(ms / (24 * 3600_000));
}

/**
 * Feature gating — the MINIMAL plan tier each feature unlocks at. This is the single
 * source of truth for what a subscription actually enforces (matched 1:1 by the
 * pricing pages — never promise a feature here that isn't gated, or vice versa).
 *
 * Tiers are cumulative: a feature at 'growth' is available to growth, autopilot, scale.
 */
export const FEATURE_MIN_PLAN = {
  // ── Publishing platforms ──
  /** Telegram publishing — every tier, including Free. */
  platform_telegram: 'free',
  /**
   * Facebook page publishing (native or via Make relay).
   *
   * At Starter, not Growth, because Starter had NOTHING of its own: same single group, same
   * Telegram-only reach as Free, differing only in credit count. A tier whose entire pitch
   * is "the same thing, more of it" is a tier nobody steps up to — and raising the free
   * quota to a post a day would have squeezed it flat. Now the ladder reads as reach:
   * Free is one channel, Starter is two, Growth is all five.
   */
  platform_facebook: 'starter',
  /** Instagram business publishing. */
  platform_instagram: 'growth',
  /** Pinterest pin publishing. */
  platform_pinterest: 'growth',
  /** WhatsApp group publishing (Green API / Cloud API). */
  platform_whatsapp: 'growth',

  // ── Product sources ──
  /** AliExpress keyword search — every tier, including Free. */
  source_aliexpress: 'free',
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

  // ── Automation add-ons ──
  /** Sales-recovery auto-push (order-drop → boost hot products). */
  sales_recovery: 'autopilot',
  /** Paid-ads auto-boost (Meta Ads, ROAS-driven). */
  paid_boost: 'scale',
  /** ClickLead landing pages + ROI (SSO). */
  landing_pages: 'scale',
  /** Nightly learning optimizer: keyword scoring → retire/boost + morning digest. */
  learning_optimizer: 'autopilot',
  /** Bonus-pool steering: the autopilot prefers categories that currently pay an
   *  AliExpress incentive bonus. Same family as the seasonal calendar and the nightly
   *  optimizer — the system deciding what is worth publishing — so the same tier.
   *  (The monthly "go register" reminder is deliberately NOT gated: it costs nothing
   *  and it is what makes a lower tier want the automation above it.) */
  incentive_steering: 'autopilot',

  // ── The account's own Telegram bot (telegram-bot/tenant-bot.ts) ──
  /** A readers' search bot of the account's own: readers find the account's products,
   *  price-drop alerts and parcel tracking — all through links that earn the account. */
  search_bot: 'growth',
  /** The manager agent in the account owner's own chat with that bot: questions about
   *  campaigns and clicks, proposals with ✅/❌, and the Sunday weekly review. */
  manager_agent: 'autopilot',
} as const;

export type FeatureKey = keyof typeof FEATURE_MIN_PLAN;

/** Max WhatsApp connections per tier (0 = platform locked anyway). */
export const WHATSAPP_CONNECTIONS: Record<PlanId, number> = {
  free: 0, starter: 0, growth: 1, autopilot: 2, scale: 3,
};

/** True when `plan` is at or above the feature's minimal tier. Callers that must honour a
 *  running trial pass `effectivePlan(...)` in, rather than the stored plan. */
export function planAllows(plan: string | null | undefined, feature: FeatureKey): boolean {
  const tier = PLAN_ORDER.indexOf(planOf(plan).id);
  const need = PLAN_ORDER.indexOf(FEATURE_MIN_PLAN[feature] as PlanId);
  return tier >= need;
}

/**
 * One-time credit top-up packs a user can buy when the monthly quota runs out.
 * Purchased credits are ADDED to the current balance (they ride the same
 * credits_remaining counter; the monthly refill still resets to the plan quota,
 * so packs are meant to bridge the current month). Priced above the effective
 * per-credit price of the plans — the plans stay the better deal.
 */
export const CREDIT_PACKS = [
  { id: 'pack_5k', credits: 5_000, price: 59, label: 'חבילת בוסט' },
  { id: 'pack_15k', credits: 15_000, price: 149, label: 'חבילת האצה' },
  { id: 'pack_50k', credits: 50_000, price: 399, label: 'חבילת טורבו' },
] as const;

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
