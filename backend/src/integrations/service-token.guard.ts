import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';

/**
 * Machine-to-machine auth for the ClickLead bridge: the caller (ai-function)
 * presents the shared INTEGRATION_SERVICE_TOKEN in `x-integration-token`.
 * No token configured = the bridge is off and every call is rejected.
 */
@Injectable()
export class ServiceTokenGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const expected = process.env.INTEGRATION_SERVICE_TOKEN || '';
    const req = ctx.switchToHttp().getRequest();
    const given = String(req.headers['x-integration-token'] || '');
    // Hash both sides so timingSafeEqual gets equal-length buffers.
    const a = createHash('sha256').update(expected).digest();
    const b = createHash('sha256').update(given).digest();
    if (!expected || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('invalid service token');
    }
    return true;
  }
}
