import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { WatchdogService } from './watchdog.service';
import { TelegramBotService } from '../telegram-bot/telegram-bot.service';

/** Constant-time string compare — avoids leaking the secret via response timing. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a || '');
  const bb = Buffer.from(b || '');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * PUBLIC endpoint Telegram POSTs bot updates to (set via setWebhook on boot). Auth is the
 * secret_token header Telegram echoes back — anything else is silently ignored. Always
 * answers 200 so Telegram never retry-storms.
 *
 * One bot serves several features, split here: a bare status request goes to the watchdog,
 * and everything else (owner searches and questions, members' searches, inline buttons) to
 * the product bot.
 */
@Controller('telegram')
export class TelegramWebhookController {
  constructor(
    private readonly watchdog: WatchdogService,
    private readonly bot: TelegramBotService,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Headers('x-telegram-bot-api-secret-token') secret: string,
    @Body() body: any,
  ) {
    if (secret && safeEqual(secret, this.watchdog.telegramWebhookSecret())) {
      // A callback_query carries no message text, so button taps always reach the bot.
      const text = String(body?.message?.text || '').trim();
      // A bare "/status" or "מה המצב?" is the status report; a longer sentence that merely
      // contains one of those words ("מה המצב עם פינטרסט השבוע?") is a question for the
      // manager agent, which the product bot routes.
      const isStatus = this.watchdog.isStatusRequest(text)
        && (text.startsWith('/') || text.split(/\s+/).length <= 3);
      const handled = isStatus
        ? this.watchdog.handleTelegramUpdate(body)
        : this.bot.handleUpdate(body);
      await handled.catch(() => {});
    }
    return { ok: true };
  }
}
