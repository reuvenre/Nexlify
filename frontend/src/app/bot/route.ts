import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * The readers' search bot, on the pretty domain: <site>/bot → the bot's private chat.
 *
 * A static, shareable address for announcements and anywhere a link cannot be hidden
 * behind text (WhatsApp, Facebook, a printed sign) — instead of the raw
 * t.me/<bot_username>?start=post. `start=post` opens the chat with the bot's two-line
 * search instructions. SEARCH_BOT_USERNAME overrides the bot if it is ever replaced.
 */
const BOT = (process.env.SEARCH_BOT_USERNAME || 'nexlify_watchdog_bot').trim().replace(/^@/, '');

export function GET() {
  return NextResponse.redirect(`https://t.me/${BOT}?start=post`, 302);
}
