import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CredentialsService } from '../credentials/credentials.service';
import { AiUsageService } from './ai-usage.service';

/** Dashboard AI token-usage metering (daily consumption + monthly budget gauge). */
@Controller('ai/usage')
@UseGuards(JwtAuthGuard)
export class AiUsageController {
  constructor(
    private readonly usage: AiUsageService,
    private readonly credentials: CredentialsService,
  ) {}

  private uid(req: Request) { return (req.user as any).id; }

  @Get()
  async get(@Req() req: Request, @Query('days') days?: string) {
    const userId = this.uid(req);
    const creds = await this.credentials.getRaw(userId).catch(() => null);
    const budget = creds?.ai_monthly_token_budget ?? null;
    const window = Math.min(60, Math.max(7, Number(days) || 14));
    return this.usage.summary(userId, budget, window);
  }
}
