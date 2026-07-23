import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import {
  BillingCycle, CREDIT_COSTS, CREDIT_PACKS, FEATURE_MIN_PLAN, FeatureKey, PLANS, PlanId,
  WHATSAPP_CONNECTIONS, planAllows, planOf,
} from './plans.const';
import { MailService } from '../mail/mail.service';
import { PromotionsService } from '../promotions/promotions.service';

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
  /** Admin accounts never consume credits — the UI shows ∞ instead of a balance. */
  unlimited: boolean;
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
    private readonly mail: MailService,
    private readonly promotions: PromotionsService,
  ) {}

  /**
   * Self-service upgrade — the confirm-dialog flow. Applies any active promotion
   * to the quoted price, then:
   *  • PAYMENT_CHECKOUT_URL set → returns a checkout redirect (the gateway's
   *    success webhook calls setPlanForUser → the plan flips the same second).
   *  • No gateway yet → records the request and emails every admin the exact
   *    quote; the plan is activated manually. The UI tells the user it's pending.
   * Either way the user never self-grants a paid tier without payment.
   */
  async requestUpgrade(userId: string, planId: string, billing: BillingCycle = 'monthly') {
    const plan = PLANS[planId as PlanId];
    if (!plan) throw new BadRequestException('תוכנית לא מוכרת');
    if (billing !== 'monthly' && billing !== 'annual') billing = 'monthly';
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    if (user.subscription_plan === plan.id) {
      throw new BadRequestException('זו כבר התוכנית הנוכחית שלך');
    }

    // Quote with any active promo applied — the same price the pricing UI showed.
    const base = billing === 'annual' ? plan.price_annual : plan.price_monthly;
    const deals = await this.promotions.active().catch(() => []);
    const deal = deals.find((d) => d.target_type === 'plan' && d.target_id === plan.id)
      || deals.find((d) => d.target_type === 'all_plans')
      || null;
    const price = deal ? PromotionsService.dealPrice(base, deal) : base;

    // Payment-gateway hook point (Grow/Meshulam/Stripe…): hand off to checkout.
    const checkoutBase = process.env.PAYMENT_CHECKOUT_URL;
    if (checkoutBase) {
      const url = `${checkoutBase}${checkoutBase.includes('?') ? '&' : '?'}`
        + `plan=${plan.id}&billing=${billing}&price=${price}&uid=${user.id}`;
      return { status: 'checkout' as const, checkout_url: url, plan: plan.id, billing, price };
    }

    // No gateway yet — notify every admin with the exact quote for manual activation.
    this.logger.log(`Upgrade request: ${user.email} → ${plan.id} (${billing}) at ₪${price}`);
    if (this.mail.isConfigured()) {
      const admins = await this.users.find({ where: { role: 'admin' } });
      const html = `<div dir="rtl" style="font-family:Arial,sans-serif;padding:16px">
        <h3>בקשת שדרוג חדשה 🚀</h3>
        <p><b>${user.email}</b> ביקש לשדרג לתוכנית <b>${plan.name}</b> (חיוב ${billing === 'annual' ? 'שנתי' : 'חודשי'})
        במחיר <b>₪${price}</b>${deal ? ` (מבצע: ${deal.title})` : ''}.</p>
        <p>לאחר קבלת התשלום — אדמין ← משתמשים ← נהל ← בחר ${plan.name}.</p>
      </div>`;
      for (const admin of admins) {
        await this.mail.sendHtml(admin.email, `בקשת שדרוג: ${user.email} → ${plan.name}`, html)
          .catch((err) => this.logger.warn(`upgrade-request mail to ${admin.email} failed: ${err?.message}`));
      }
    }
    return { status: 'pending' as const, plan: plan.id, billing, price };
  }

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
      unlimited: user.role === 'admin',
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
   *  is requireFeature (throws) used at user-facing entry points.
   *  Admins (the platform owners) bypass all feature gates. */
  async allows(userId: string, feature: FeatureKey): Promise<boolean> {
    const user = await this.users.findOne({ where: { id: userId } }).catch(() => null);
    if (!user) return true;
    if (user.role === 'admin') return true;
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
    const user = await this.refillIfDue(userId);
    // Admins (platform owners) never consume credits — their own campaigns must not
    // stop mid-month, and there is no one to bill.
    if (user.role === 'admin') return true;
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

  /** The purchasable one-time credit packs (static catalog). */
  listPacks() {
    return CREDIT_PACKS;
  }

  /**
   * Grant extra credits to a user — the admin fulfilment side of a credit-pack
   * purchase (until a payment gateway automates it). Adds on TOP of the current
   * balance; the next monthly refill still resets to the plan quota.
   */
  async addCredits(userId: string, amount: number) {
    const n = Math.floor(amount);
    if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) {
      throw new BadRequestException('כמות קרדיטים לא תקינה');
    }
    await this.refillIfDue(userId); // settle the cycle first so the top-up isn't wiped by a due refill
    await this.users.increment({ id: userId }, 'credits_remaining', n);
    const user = await this.users.findOne({ where: { id: userId } });
    return { ok: true, credits_remaining: user?.credits_remaining ?? null };
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
