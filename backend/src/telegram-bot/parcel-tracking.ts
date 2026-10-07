import { escapeHtml } from './shopper';

/**
 * «איפה החבילה שלי?» — the readers' parcel tracking, pure parts.
 *
 * A reader who bought through the channel waits two to four weeks for an AliExpress parcel.
 * They send the tracking number to the bot and get its page on 17TRACK at once (free, no
 * key). With a 17TRACK API key the bot also offers «🔔 עדכנו אותי»: the number is registered
 * and the reader hears each time the parcel reaches a new stage — left China, landed in
 * Israel, out of customs, waiting at the pickup point. It brings them back to the bot after
 * the purchase, which is where the next search starts.
 *
 * 17TRACK counts every REGISTERED number against the account's quota (new accounts get 200,
 * once), so a number is registered only when a reader asks for updates, never for a lookup.
 */

/** Active parcels one reader may follow at once. */
export const MAX_PARCELS_PER_READER = 5;
/** Registrations per day across all readers — the quota is small and does not refill. */
export const DEFAULT_DAILY_REGISTRATIONS = 15;
/** A parcel not delivered in this long is no longer followed. */
export const PARCEL_TTL_DAYS = 75;

/** Callback payloads: follow / stop following one number. */
export const PARCEL_FOLLOW = 'pk';
export const PARCEL_STOP = 'pq';

/**
 * A tracking number in a reader's message, or null. Explicit forms («/track X», «מעקב X»)
 * take any plausible number; a bare message must look like one beyond doubt — a single
 * token of 10–30 letters and digits with at least 8 digits and 2 letters — so a product
 * search («cz p10c», «rtx 4090») is never mistaken for a parcel.
 */
export function parseTrackingNumber(text: string): string | null {
  const t = String(text || '').trim();
  const explicit = t.match(/^(?:\/track(?:@\S+)?|מעקב(?:\s+חבילה)?|track)\s+([A-Za-z0-9-]{8,40})$/i);
  const raw = explicit ? explicit[1] : (/^[A-Za-z0-9-]{10,30}$/.test(t) ? t : '');
  if (!raw) return null;
  const n = raw.toUpperCase().replace(/-/g, '');
  const digits = (n.match(/\d/g) || []).length;
  const letters = (n.match(/[A-Z]/g) || []).length;
  if (n.length < 8 || n.length > 30) return null;
  if (explicit) return digits >= 6 ? n : null;
  return digits >= 8 && letters >= 2 ? n : null;
}

/** A bare «/track» or «מעקב» — the reader asked how. */
export function isTrackHelp(text: string): boolean {
  return /^(?:\/track(?:@\S+)?|\/parcels(?:@\S+)?|מעקב(?: חבילה)?|איפה החבילה(?: שלי)?\??)$/i.test(String(text || '').trim());
}

/** The parcel's public page on 17TRACK — works with no key and no quota. */
export function trackingLink(number: string): string {
  return `https://t.17track.net/en#nums=${encodeURIComponent(number)}`;
}

export interface ParcelState {
  status: string | null;
  subStatus: string | null;
  eventTime: string | null;
  eventText: string | null;
  eventLocation: string | null;
}

/** Read 17TRACK's track_info (gettrackinfo, accepted[i].track_info) defensively. */
export function readTrackInfo(info: any): ParcelState {
  const latest = info?.latest_status || {};
  const ev = info?.latest_event || {};
  return {
    status: latest.status ? String(latest.status) : null,
    subStatus: latest.sub_status ? String(latest.sub_status) : null,
    eventTime: ev.time_utc || ev.time_iso || null,
    eventText: ev.description ? String(ev.description).slice(0, 300) : null,
    eventLocation: ev.location ? String(ev.location).slice(0, 80) : null,
  };
}

const SUB_TEXT: Record<string, string> = {
  InTransit_PickedUp: '📦 החבילה נאספה מהמוכר',
  InTransit_Departure: '✈️ החבילה יצאה מארץ המוצא',
  InTransit_Arrival: '🇮🇱 החבילה הגיעה לישראל',
  InTransit_CustomsProcessing: '🛃 החבילה בשחרור מהמכס',
  InTransit_CustomsReleased: '🛃 החבילה שוחררה מהמכס',
  InTransit_CustomsRequiringInformation: '🛃 המכס מבקש פרטים — כדאי לבדוק הודעות SMS או מייל מדואר ישראל',
  DeliveryFailure_NoBody: '⚠️ ניסיון מסירה נכשל — לא היה מי שיקבל',
  DeliveryFailure_Security: '⚠️ המסירה נעצרה בגלל מכס או תשלום',
  DeliveryFailure_Rejected: '⚠️ החבילה סורבה במסירה',
  DeliveryFailure_InvalidAddress: '⚠️ המסירה נכשלה — בעיה בכתובת',
  Exception_Returning: '↩️ החבילה בדרך חזרה לשולח',
  Exception_Returned: '↩️ החבילה חזרה לשולח',
  Exception_Delayed: '⏳ החבילה מתעכבת',
  Exception_Lost: '❗ החבילה דווחה כאבודה — כדאי לפתוח מחלוקת באלי אקספרס',
  Exception_Damage: '❗ החבילה ניזוקה בדרך',
  Exception_Security: '❗ עיכוב בבדיקת מכס או ביטחון',
  Exception_Rejected: '❗ החבילה סורבה',
  Exception_Destroyed: '❗ החבילה הושמדה',
  Exception_Cancel: '❗ המשלוח בוטל',
};

const STATUS_TEXT: Record<string, string> = {
  NotFound: '🔎 עדיין אין מידע מחברת השילוח — לפעמים זה לוקח יום-יומיים אחרי ההזמנה',
  InfoReceived: '📝 המוכר מסר את פרטי המשלוח, החבילה עוד לא נאספה',
  InTransit: '🚛 החבילה בדרך',
  Expired: '⏳ החבילה בדרך כבר זמן רב',
  AvailableForPickup: '📍 החבילה ממתינה לאיסוף!',
  OutForDelivery: '🚚 החבילה יצאה למסירה — היום אצלך',
  DeliveryFailure: '⚠️ ניסיון מסירה נכשל',
  Delivered: '✅ החבילה נמסרה',
  Exception: '❗ יש בעיה במשלוח',
};

/** The parcel's stage in the reader's words. */
export function statusText(status: string | null, subStatus: string | null): string {
  if (subStatus && SUB_TEXT[subStatus]) return SUB_TEXT[subStatus];
  if (status && STATUS_TEXT[status]) return STATUS_TEXT[status];
  return STATUS_TEXT.NotFound;
}

/** A stage the reader wants to hear about — not every scan in a sorting centre. */
export function isNewStage(prev: { status: string | null; subStatus: string | null }, next: ParcelState): boolean {
  if (!next.status || next.status === 'NotFound') return false;
  return next.status !== prev.status || (next.subStatus || '') !== (prev.subStatus || '');
}

/** Delivered, or finished badly enough that following it is over. */
export function isFinal(status: string | null, subStatus: string | null): boolean {
  return status === 'Delivered'
    || subStatus === 'Exception_Returned' || subStatus === 'Exception_Destroyed' || subStatus === 'Exception_Cancel';
}

/** The message a reader gets: the stage, the carrier's own last line, and the full page. */
export function parcelCard(number: string, state: ParcelState | null, opts: { label?: string | null; update?: boolean } = {}): string {
  const lines = [
    `${opts.update ? '📬 עדכון משלוח' : '📦 מעקב משלוח'} <code>${escapeHtml(number)}</code>${opts.label ? ` · ${escapeHtml(opts.label)}` : ''}`,
  ];
  if (state?.status) {
    lines.push(`<b>${statusText(state.status, state.subStatus)}</b>`);
    if (state.eventText) {
      const when = state.eventTime ? israelTime(state.eventTime) : '';
      lines.push(`${when ? `${when} · ` : ''}${escapeHtml(state.eventText)}${state.eventLocation ? ` (${escapeHtml(state.eventLocation)})` : ''}`);
    }
  }
  lines.push(`<a href="${trackingLink(number)}">🔗 כל הפרטים ב-17TRACK</a>`);
  return lines.join('\n');
}

/** «7/10 14:05», Israel time. */
export function israelTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return `${Number(get('day'))}/${Number(get('month'))} ${get('hour')}:${get('minute')}`;
}

export function followButton(number: string, following = false) {
  return following
    ? { text: '🔕 הפסק מעקב', callback_data: `${PARCEL_STOP}:${number}` }
    : { text: '🔔 עדכנו אותי כשהחבילה זזה', callback_data: `${PARCEL_FOLLOW}:${number}` };
}

export function parseParcelCallback(data: string): { action: 'follow' | 'stop'; number: string } | null {
  const m = String(data || '').match(/^(pk|pq):([A-Z0-9]{8,30})$/);
  if (!m) return null;
  return { action: m[1] === PARCEL_FOLLOW ? 'follow' : 'stop', number: m[2] };
}

export const PARCEL_HELP = [
  '📦 מעקב משלוח: שלחו לי את מספר המעקב של ההזמנה (באלי אקספרס: ההזמנות שלי ← מעקב).',
  'למשל: LP00123456789012 או RB123456789CN',
  'אשלח קישור למצב החבילה, ואם תרצו — אעדכן אתכם בכל שלב, עד שהיא מגיעה.',
].join('\n');
