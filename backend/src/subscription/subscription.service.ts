import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import {
  BillingCycle, CREDIT_COSTS, FEATURE_MIN_PLAN, FeatureKey, PLANS, PlanId,
  WHATSAPP_CONNECTIONS, planAllows, planOf,
} from './plans.const';

/** Hebrew display names for gated features — used in upgrade error messages. */
const FEATURE_LABELS: Record<FeatureKey, string> = {
  platform_telegram: 'פרסום לטלגרם',
  platform_facebook: 'פרסום לפייסבוק',
  platform_instagram: 'פרסום לאינסטגרם',
  platform_pinterest: 'פרסום לפינטרסט',
  platform_whatsapp: 'פרסום לוואטסאפ',
  source_aliexpress: 'AliExpress',
  source_amazon: 'קמפיין אמזון',
  source_flylink: 'קמפיין ספקים',
  ai_agents: 'סוכני AI',
  winner_recycling: 'מיחזור מנצחים',
  seasonal_calendar: 'עונתיות — לוח שנה מסחרי',
  campaign_window_tz: 'חלון שליחה לפי אזור זמן',
  attribution_report: 'דוח אטריבושן',
  token_tracking: 'מעקב טוקנים ותקציב AI',
  image_enhancer: 'משפר תמונות AI',
  english_campaigns: 'קמפיין באנגלית לקהל ארה"ב',
};

export interface SubscriptionStatus {
  plan: PlanId;
  plan_name: string;
  billing: BillingCycle;
  price: number;
  credits_remaining: number;
  monthly_credits: number;
  max_groups: number | null;
  renews_at: string | null;
}

/**
 * The 1st of the NEXT calendar month at 00:00. Credits refill on the 1st of every month
 * (not a rolling anniversary), so everyone's cycle resets together at month start.
 * Handles December → January rollover via the Date constructor's month overflow.
 */
function firstOfNextMonth(from = new Date()): Date {
  const d = new Date(from);
  return new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0);
}

/**
 * Demo-mode subscription engine: plan switching is instant (no payment gateway),
 * but everything else is REAL — credits persist in the DB, refill monthly (lazily,
 * on first use after the renewal date), and are enforced on AI generation, post
 * publishing, and channel creation.
 */
@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  /** Full plan catalog for the pricing page — each plan carries the feature keys it
   *  UNLOCKS (gating truth, so pricing UIs can't drift from what's actually enforced)
   *  and its WhatsApp connection count. */
  listPlans() {
    return Object.values(PLANS).map((p) => ({
      ...p,
      whatsapp_connections: WHATSAPP_CONNECTIONS[p.id],
      unlocks: (Object.keys(FEATURE_MIN_PLAN) as FeatureKey[])
        .filter((k) => FEATURE_MIN_PLAN[k] === p.id),
    }));
  }

  /** Current subscription state for a user (applies the lazy monthly refill). */
  async getStatus(userId: string): Promise<SubscriptionStatus> {
    const user = await this.refillIfDue(userId);
    const plan = planOf(user.subscription_plan);
    const billing = (user.plan_billing as BillingCycle) || 'monthly';
    return {
      plan: plan.id,
      plan_name: plan.name,
      billing,
      price: billing === 'annual' ? plan.price_annual : plan.price_monthly,
      credits_remaining: user.credits_remaining ?? 0,
      monthly_credits: plan.monthly_credits,
      max_groups: plan.max_groups,
      renews_at: user.plan_renews_at ? new Date(user.plan_renews_at).toISOString() : null,
    };
  }

  /**
   * Grant a plan to a user (admin or, in future, a payment webhook). This is the ONLY
   * write path to a subscription — there is no self-service switch, because plans are
   * paid and no payment gateway is wired yet. Always refills to the plan's monthly
   * credits and starts a fresh cycle.
   */
  async setPlanForUser(userId: string, planId: string, billing: BillingCycle = 'monthly') {
    const plan = PLANS[planId as PlanId];
    if (!plan) throw new BadRequestException('תוכנית לא מוכרת');
    if (billing !== 'monthly' && billing !== 'annual') billing = 'monthly';
    await this.users.update(userId, {
      subscription_plan: plan.id,
      plan_billing: billing,
      credits_remaining: plan.monthly_credits,
      plan_renews_at: firstOfNextMonth(),
    });
    return this.getStatus(userId);
  }

  /** Max channels/groups allowed on the user's plan (null = unlimited). */
  async getMaxGroups(userId: string): Promise<number | null> {
    const user = await this.users.findOne({ where: { id: userId } });
    return planOf(user?.subscription_plan).max_groups;
  }

  /** Whether the user's plan includes a gated feature. Fail-open on a missing user is
   *  deliberate here — gating must never brick internal/system flows; the strict path
   *  is requireFeature (throws) used at user-facing entry points. */
  async allows(userId: string, feature: FeatureKey): Promise<boolean> {
    const user = await this.users.findOne({ where: { id: userId } }).catch(() => null);
    if (!user) return true;
    return planAllows(user.subscription_plan, feature);
  }

  /** Throw the standard Hebrew upgrade message when the plan lacks a feature. */
  async requireFeature(userId: string, feature: FeatureKey): Promise<void> {
    if (await this.allows(userId, feature)) return;
    const minPlan = PLANS[FEATURE_MIN_PLAN[feature] as PlanId];
    throw new BadRequestException(
      `"${FEATURE_LABELS[feature]}" זמין החל מתוכנית ${minPlan.name} — שדרג בהגדרות ← מנוי`,
    );
  }

  /** Max WhatsApp connections for the user's plan. */
  async getWhatsappConnections(userId: string): Promise<number> {
    const user = await this.users.findOne({ where: { id: userId } }).catch(() => null);
    return WHATSAPP_CONNECTIONS[planOf(user?.subscription_plan).id];
  }

  /**
   * The publish platforms the user's plan includes, as one cheap lookup (the post
   * fan-out calls this on every send). Fail-open on a missing user — see allows().
   */
  async platformGate(userId: string): Promise<Set<string>> {
    const all = ['telegram', 'facebook', 'instagram', 'pinterest', 'whatsapp'];
    const user = await this.users.findOne({ where: { id: userId } }).catch(() => null);
    if (!user) return new Set(all);
    return new Set(all.filter((p) => planAllows(user.subscription_plan, `platform_${p}` as FeatureKey)));
  }

  /**
   * Atomically consume credits. Returns true if the balance covered the cost.
   * The WHERE clause makes the check-and-decrement a single statement, so two
   * concurrent sends can't both spend the last credits.
   */
  async tryConsume(userId: string, amount: number, reason: string): Promise<boolean> {
    await this.refillIfDue(userId);
    const res = await this.users
      .createQueryBuilder()
      .update(User)
      .set({ credits_remaining: () => `credits_remaining - ${Math.floor(amount)}` })
      .where('id = :id AND credits_remaining >= :amount', { id: userId, amount: Math.floor(amount) })
      .execute();
    const ok = (res.affected ?? 0) > 0;
    if (!ok) this.logger.warn(`User ${userId}: insufficient credits for ${reason} (cost ${amount})`);
    return ok;
  }

  /** Consume credits or throw the standard Hebrew upgrade message. */
  async consumeOrThrow(userId: string, amount: number, reason: string): Promise<void> {
    const ok = await this.tryConsume(userId, amount, reason);
    if (!ok) {
      throw new BadRequestException(
        'נגמרו הקרדיטים בתוכנית שלך — שדרג תוכנית בהגדרות ← מנוי כדי להמשיך',
      );
    }
  }

  /** Cost table exposed for callers (so costs stay single-sourced). */
  get costs() {
    return CREDIT_COSTS;
  }

  /**
   * Lazy monthly refill: if the renewal date passed (or was never set — e.g. a
   * user created before this feature), refill to the plan's monthly credits and
   * schedule the next cycle. Runs before any read/consume, so no cron is needed.
   */
  private async refillIfDue(userId: string): Promise<User> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');

    const due = !user.plan_renews_at || new Date(user.plan_renews_at) <= new Date();
    if (!due) return user;

    const plan = planOf(user.subscription_plan);
    user.credits_remaining = plan.monthly_credits;
    user.plan_renews_at = firstOfNextMonth();
    await this.users.update(user.id, {
      credits_remaining: user.credits_remaining,
      plan_renews_at: user.plan_renews_at,
    });
    return user;
  }
}
