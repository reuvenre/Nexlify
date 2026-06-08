export type PlanTier = 'free' | 'starter' | 'growth' | 'autopilot' | 'scale';

/** Ordered from lowest to highest — index is the tier's rank. */
export const PLAN_ORDER: PlanTier[] = ['free', 'starter', 'growth', 'autopilot', 'scale'];

export function planRank(plan: string | undefined): number {
  const idx = PLAN_ORDER.indexOf((plan ?? 'free') as PlanTier);
  return idx === -1 ? 0 : idx;
}

export function planMeetsRequirement(userPlan: string | undefined, required: PlanTier): boolean {
  return planRank(userPlan) >= planRank(required);
}
