import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '');

/**
 * The readers' search bot, on the pretty domain: <site>/bot → the bot's private chat.
 *
 * A static, shareable address for announcements and anywhere a link cannot be hidden
 * behind text (WhatsApp, Facebook, a printed sign). The backend names the bot readers
 * belong to — the dedicated search bot once SEARCH_BOT_TOKEN is set — so this link follows
 * a bot change without a redeploy. `start=post` opens the chat with the search
 * instructions. The fallback is the owner's bot, which forwards readers on.
 */
const FALLBACK_BOT = (process.env.SEARCH_BOT_USERNAME || 'nexlify_watchdog_bot').trim().replace(/^@/, '');

export async function GET() {
  let bot = FALLBACK_BOT;
  try {
    const res = await fetch(`${API}/telegram/search-bot`, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    const data = (await res.json().catch(() => null)) as { username?: string | null } | null;
    if (data?.username && /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(data.username)) bot = data.username;
  } catch { /* the fallback bot still answers */ }
  return NextResponse.redirect(`https://t.me/${bot}?start=post`, 302);
}
