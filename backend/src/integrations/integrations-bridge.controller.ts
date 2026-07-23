import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ServiceTokenGuard } from './service-token.guard';
import { IntegrationsService } from './integrations.service';

/**
 * Machine-to-machine side of the ClickLead bridge (no user JWT — the caller
 * is the ClickLead ai-function, authenticated by the shared service token).
 * Kept separate from IntegrationsController, whose class-level JwtAuthGuard
 * covers the user-facing SSO route.
 */
@Controller('integrations/clicklead')
@UseGuards(ServiceTokenGuard)
export class IntegrationsBridgeController {
  constructor(private readonly svc: IntegrationsService) {}

  /** Earnings attributed to a Telegram chat — powers ClickLead's ROI tab. */
  @Get('earnings')
  earnings(
    @Query('chat_id') chatId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.svc.earningsForChat(chatId, from, to);
  }
}
