import { SetMetadata } from '@nestjs/common';
import { PlanTier } from './plans';

export const PLAN_KEY = 'requiredPlan';

/** Restrict a route to users whose plan is at or above the given tier (e.g. @RequiresPlan('growth')). Admins always bypass. */
export const RequiresPlan = (plan: PlanTier) => SetMetadata(PLAN_KEY, plan);
