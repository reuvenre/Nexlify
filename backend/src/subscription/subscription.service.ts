import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { BillingCycle, CREDIT_COSTS, PLANS, PlanId, planOf } from './plans.const';

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

function nextMonth(from = new Date()): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + 1);
  return d;
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

  /** Full plan catalog for the pricing page. */
  listPlans() {
    return Object.values(PLANS);
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
   * Demo-mode purchase: activates the plan immediately, refills credits to the
   * plan's monthly amount and starts a new cycle. A real payment-gateway step
   * (Grow/PayPlus/Stripe) slots in front of this call later.
   */
  async switchPlan(userId: string, planId: string, billing: BillingCycle = 'monthly'): Promise<SubscriptionStatus> {
    const plan = PLANS[planId as PlanId];
    if (!plan) throw new BadRequestException('תוכנית לא מוכרת');
    if (billing !== 'monthly' && billing !== 'annual') billing = 'monthly';

    const user = await this.users.findOne({ where: { id: userId } });
    const isSamePlan = user?.subscription_plan === plan.id;

    // Only (re)fill credits on a REAL plan change — otherwise re-posting the same
    // plan would reset credits to full on demand, an unlimited free-AI bypass
    // (AI can fall back to the operator's server key). Switching plan grants the
    // new plan's credits; staying on the same plan keeps the current balance.
    const patch: any = {
      subscription_plan: plan.id,
      plan_billing: billing,
    };
    if (!isSamePlan) {
      patch.credits_remaining = plan.monthly_credits;
      patch.plan_renews_at = nextMonth();
    }
    await this.users.update(userId, patch);
    this.logger.log(`User ${userId} switched to plan ${plan.id} (${billing}) [demo mode, refill=${!isSamePlan}]`);
    return this.getStatus(userId);
  }

  /** Admin: set any user's plan. Always refills (an admin action, not self-service). */
  async setPlanForUser(userId: string, planId: string, billing: BillingCycle = 'monthly') {
    const plan = PLANS[planId as PlanId];
    if (!plan) throw new BadRequestException('תוכנית לא מוכרת');
    if (billing !== 'monthly' && billing !== 'annual') billing = 'monthly';
    await this.users.update(userId, {
      subscription_plan: plan.id,
      plan_billing: billing,
      credits_remaining: plan.monthly_credits,
      plan_renews_at: nextMonth(),
    });
    return this.getStatus(userId);
  }

  /** Max channels/groups allowed on the user's plan (null = unlimited). */
  async getMaxGroups(userId: string): Promise<number | null> {
    const user = await this.users.findOne({ where: { id: userId } });
    return planOf(user?.subscription_plan).max_groups;
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
    user.plan_renews_at = nextMonth();
    await this.users.update(user.id, {
      credits_remaining: user.credits_remaining,
      plan_renews_at: user.plan_renews_at,
    });
    return user;
  }
}
