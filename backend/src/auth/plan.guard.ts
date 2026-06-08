import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PLAN_KEY } from './plan.decorator';
import { PlanTier, planMeetsRequirement } from './plans';

@Injectable()
export class PlanGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PlanTier>(PLAN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const { user } = context.switchToHttp().getRequest();
    if (user?.role === 'admin') return true; // admins bypass plan limits

    if (!planMeetsRequirement(user?.plan, required)) {
      throw new ForbiddenException(`This feature requires the "${required}" plan or higher`);
    }
    return true;
  }
}
