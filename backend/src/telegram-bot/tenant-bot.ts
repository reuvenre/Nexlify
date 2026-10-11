import { createHash, randomBytes } from 'crypto';

/**
 * Every account's own Telegram bot — the readers' search (Growth) and, in the account
 * owner's linked chat, the manager agent (Autopilot).
 *
 * The platform owner's bots (WATCHDOG_TELEGRAM_*, SEARCH_BOT_TOKEN) stay exactly as they
 * were. A customer pastes a BotFather token in Settings; the bot's webhook then points to
 * /telegram/tenant/<user_id>, and the path is what says whose bot an update came through.
 * The secret Telegram echoes back is derived per account, so one account's secret opens
 * nothing of another's.
 *
 * Inside that account's bot every reply, every product search and every log row is the
 * account's: TelegramBotService runs the update with { token, userId, managerChat } in its
 * AsyncLocalStorage, and ownerUserId()/isOwner() answer from it.
 */

export const TENANT_WEBHOOK_PREFIX = '/telegram/tenant';

export function tenantWebhookPath(userId: string): string {
  return `${TENANT_WEBHOOK_PREFIX}/${userId}`;
}

/** The secret Telegram echoes on every delivery to this account's bot. Hex fits Telegram's
 *  allowed alphabet; derived, so nothing new has to be stored. */
export function tenantWebhookSecret(userId: string): string {
  const base = (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim() || process.env.JWT_SECRET || 'nexlify';
  return createHash('sha256').update(`tg-tenant-webhook:${base}:${userId}`).digest('hex').slice(0, 48);
}

/** The public URL of this account's webhook, or null without a public backend. */
export function tenantWebhookUrl(userId: string): string | null {
  const base = (process.env.BACKEND_URL || '').replace(/\/$/, '');
  if (!base || /localhost|127\.0\.0\.1/.test(base)) return null;
  return `${base}${tenantWebhookPath(userId)}`;
}

/** A BotFather token's shape: "<bot id>:<35 characters>". Checked before any API call. */
export function looksLikeBotToken(raw: string | null | undefined): boolean {
  return /^\d{5,15}:[A-Za-z0-9_-]{30,50}$/.test(String(raw || '').trim());
}

/** The one-time code that links the account owner's private chat to the bot. */
export function newLinkCode(): string {
  return randomBytes(6).toString('hex');
}

/** persistent_values key holding a link code's account, 30 minutes. */
export function linkCodeKey(code: string): string {
  return `tenant_bot_link:${code}`;
}

export const LINK_CODE_TTL_MS = 30 * 60 * 1000;

/** The code in «/start link_<code>», which is what the deep link in Settings sends. */
export function parseLinkStart(text: string | null | undefined): string | null {
  const m = String(text || '').trim().match(/^\/start(?:@\S+)?\s+link_([a-f0-9]{12})$/i);
  return m ? m[1].toLowerCase() : null;
}

/** The deep link that opens the bot and sends the link code in one tap. */
export function linkDeepLink(botUsername: string, code: string): string {
  return `https://t.me/${botUsername}?start=link_${code}`;
}

/** What a reader of a bot whose account lost the plan is told — once per message, briefly. */
export const TENANT_BOT_PAUSED = '🔎 החיפוש בבוט הזה מושבת כרגע. נסו שוב מאוחר יותר 🙏';

/** What the linked owner hears when the manager is not in his plan. */
export const MANAGER_LOCKED =
  '🧠 המנהל החכם זמין בתוכנית Autopilot ומעלה. אפשר לשדרג בלוח הבקרה: הגדרות ← מנוי.\n'
  + 'בינתיים כל הודעה כאן היא חיפוש מוצר, בדיוק כמו שהקוראים שלך רואים.';
