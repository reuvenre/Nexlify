import { Body, Controller, Delete, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TelegramBotService } from './telegram-bot.service';

/**
 * Settings → "הבוט שלי": the account's own readers' bot and the manager chat linked to it
 * (tenant-bot.ts). Connecting and linking are open to every plan so the screen can show the
 * bot; what the bot then DOES is gated per update (search_bot / manager_agent).
 */
@Controller('telegram/my-bot')
@UseGuards(JwtAuthGuard)
export class TenantBotController {
  constructor(private readonly bot: TelegramBotService) {}

  private uid(req: Request): string { return (req.user as any).id; }

  @Get()
  status(@Req() req: Request) {
    return this.bot.tenantBotStatus(this.uid(req));
  }

  @Post()
  @HttpCode(200)
  connect(@Req() req: Request, @Body() body: { token?: string }) {
    return this.bot.connectTenantBot(this.uid(req), String(body?.token || ''));
  }

  @Delete()
  async disconnect(@Req() req: Request) {
    await this.bot.disconnectTenantBot(this.uid(req));
    return { ok: true };
  }

  /** A one-time deep link that links the owner's own chat (30 minutes). */
  @Post('link')
  @HttpCode(200)
  link(@Req() req: Request) {
    return this.bot.createManagerLink(this.uid(req));
  }

  @Delete('link')
  async unlink(@Req() req: Request) {
    await this.bot.unlinkManagerChat(this.uid(req));
    return { ok: true };
  }
}
