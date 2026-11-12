import { PORTAL_TZ, portalWallToDate } from '../earnings/portal-time';

/**
 * The year's big AliExpress sale days: 11.11, Black Friday and Cyber Monday.
 *
 * seasonal.ts gives each a wide window with one generic line ("sale season"). That says
 * nothing a reader can act on. The weeks before a sale and the sale itself need different
 * words: before, "put it in your cart, the price drops on the day"; on the day, "it is on
 * now, until tomorrow morning". The days themselves are also when the money is. So this
 * module names the phase, and the posting cadence doubles while a sale is live
 * (salePostsPerRun / saleIntervalMinutes).
 *
 * Every boundary is a Pacific midnight. The portal counts its day on that clock
 * (earnings/portal-time.ts), so "11.11" starts at 10:00 Israel time, not at midnight.
 */

export type SaleKey = '1111' | 'black_friday' | 'cyber_monday';
/**
 * `live` is the peak day (or weekend), the only phase that doubles the cadence. `festival`
 * is the rest of a sale that runs on after its peak: AliExpress's 11.11 festival ran
 * 1–18.11.2026 (its own release of 29.10.2026), and the owner found the posts of 12.11
 * saying nothing about it once the one-day window had closed.
 */
export type SalePhase = 'warmup' | 'live' | 'festival';

export interface SaleWindow {
  key: SaleKey;
  /** Display name (Hebrew UI). */
  name: string;
  /** Warm-up opens here (= liveFrom when a sale has no warm-up of its own). */
  warmupFrom: Date;
  liveFrom: Date;
  /** Exclusive end of the peak. */
  liveTo: Date;
  /** Exclusive end of the festival after the peak (= liveTo when there is none). */
  festivalTo: Date;
}

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');
const pacificMidnight = (y: number, m: number, d: number): Date => {
  // Normalise day overflow (Nov 31 → Dec 1) through UTC before formatting.
  const t = new Date(Date.UTC(y, m - 1, d));
  return portalWallToDate(`${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())} 00:00:00`)!;
};

/** Black Friday: the day after the fourth Thursday of November. */
export function blackFridayDay(year: number): number {
  const firstDow = new Date(Date.UTC(year, 10, 1)).getUTCDay(); // 0 = Sunday
  const firstThursday = 1 + ((4 - firstDow + 7) % 7);
  return firstThursday + 21 + 1;
}

/** The sale windows of `year`, in calendar order. */
export function saleWindows(year: number): SaleWindow[] {
  const bf = blackFridayDay(year);
  return [
    {
      key: '1111', name: '11.11',
      warmupFrom: pacificMidnight(year, 10, 28),
      liveFrom: pacificMidnight(year, 11, 11),
      liveTo: pacificMidnight(year, 11, 12),
      // The festival runs through 18.11 (exclusive end: Pacific midnight of the 19th).
      festivalTo: pacificMidnight(year, 11, 19),
    },
    {
      key: 'black_friday', name: 'בלאק פריידיי',
      warmupFrom: pacificMidnight(year, 11, bf - 10),
      liveFrom: pacificMidnight(year, 11, bf),
      liveTo: pacificMidnight(year, 11, bf + 3),
      festivalTo: pacificMidnight(year, 11, bf + 3),
    },
    {
      key: 'cyber_monday', name: 'סייבר מאנדיי',
      warmupFrom: pacificMidnight(year, 11, bf + 3),
      liveFrom: pacificMidnight(year, 11, bf + 3),
      liveTo: pacificMidnight(year, 11, bf + 4),
      festivalTo: pacificMidnight(year, 11, bf + 4),
    },
  ];
}

export interface SaleMoment { window: SaleWindow; phase: SalePhase }

/**
 * The sale phase `now` falls in, or null. A live sale wins over a running festival, and a
 * festival over another sale's warm-up (11.11 runs to 18.11, Black Friday warms up from 17.11).
 */
export function salePhase(now: Date = new Date()): SaleMoment | null {
  const year = Number(new Intl.DateTimeFormat('en-US', { timeZone: PORTAL_TZ, year: 'numeric' }).format(now));
  const t = now.getTime();
  const windows = saleWindows(year);
  const live = windows.find((w) => t >= w.liveFrom.getTime() && t < w.liveTo.getTime());
  if (live) return { window: live, phase: 'live' };
  const fest = windows.find((w) => t >= w.liveTo.getTime() && t < w.festivalTo.getTime());
  if (fest) return { window: fest, phase: 'festival' };
  const warm = windows.find((w) => t >= w.warmupFrom.getTime() && t < w.liveFrom.getTime());
  return warm ? { window: warm, phase: 'warmup' } : null;
}

/**
 * The line that opens every AliExpress post while a sale is on (peak or festival), built in
 * code. The copy hint only asks the model to name the sale, and the owner saw post after
 * post that did not. Null outside a sale, or when the body already names it.
 */
export function saleBannerLine(body: string, hebrew: boolean, now: Date = new Date()): string | null {
  const m = salePhase(now);
  if (!m || m.phase === 'warmup') return null;
  const named: Record<SaleKey, { he: string; en: string; test: RegExp }> = {
    '1111': { he: '🛒 מבצע 11.11 של אלי אקספרס', en: '🛒 AliExpress 11.11 Sale', test: /11\.11/ },
    black_friday: { he: '🖤 בלאק פריידיי באלי אקספרס', en: '🖤 AliExpress Black Friday', test: /בלאק\s*פריי?דיי|black\s*friday/i },
    cyber_monday: { he: '💻 סייבר מאנדיי באלי אקספרס', en: '💻 AliExpress Cyber Monday', test: /סייבר\s*מאנדיי|cyber\s*monday/i },
  };
  const n = named[m.window.key];
  if (n.test.test(body)) return null;
  return hebrew ? n.he : n.en;
}

/** Kill switch for the cadence boost (the copy hints stay). */
const boostDisabled = () => process.env.SALE_PEAK_BOOST_DISABLED === '1';

/** True while a sale is live and the boost is on. */
export function salePeakNow(now: Date = new Date()): boolean {
  return !boostDisabled() && salePhase(now)?.phase === 'live';
}

/** Ceiling for a boosted run, the same one the seasonal boost uses. */
export const MAX_SALE_POSTS_PER_RUN = 6;

/** Posts per run while a sale is live: twice the owner's number, capped. */
export function salePostsPerRun(base: number, peak: boolean): number {
  const own = Math.max(1, Math.floor(base) || 1);
  if (!peak) return own;
  return Math.min(own * 2, Math.max(own, MAX_SALE_POSTS_PER_RUN));
}

/**
 * Floor for a boosted group interval. Below it, a group reads like a feed, and two clocks
 * (campaign and queue) start meeting in the same minutes.
 */
export const MIN_SALE_INTERVAL_MIN = 20;

/** The group's pacing interval while a sale is live: half, never under the floor. */
export function saleIntervalMinutes(interval: number, peak: boolean): number {
  if (!peak || !(interval > 0)) return interval;
  return Math.max(Math.min(interval, MIN_SALE_INTERVAL_MIN), Math.round(interval / 2));
}

/** An instant as Israel wall time: { date: '11.11', time: '10:00' }. */
export function israelTime(d: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const get = (k: string) => parts.find((p) => p.type === k)?.value || '';
  return { date: `${Number(get('day'))}.${Number(get('month'))}`, time: `${get('hour')}:${get('minute')}` };
}

/**
 * Cyber Monday's last stretch gets last-call copy: it really is the end of the Black Friday
 * sales. 14 h before the 10:00 close is 20:00 Israel the evening before, the group's prime
 * time. 11.11 never does: the owner asked that its posts stress the 11.11 sale and never
 * call it a last chance, since AliExpress's deals do not end with the day.
 */
export const LAST_CALL_MS = 14 * 3600_000;

const NEVER_INVENT_HE = 'אל תמציא אחוזי הנחה ואל תבטיח שהמחיר ירד.';
const NEVER_INVENT_EN = 'Never invent discount numbers or promise a price drop.';
const NOT_LAST_CHANCE_HE = 'אל תכתוב שזו הזדמנות אחרונה, שהמבצע נגמר או שהזמן אוזל.';
const NOT_LAST_CHANCE_EN = 'Never call it a last chance or say the sale is ending.';

/**
 * The copy context for the phase `now` is in, or null outside every window. A fact about the
 * calendar, true of every product, so it rides every post (seasonalCopyHints' sale line).
 */
export function saleCopyHint(language: string, now: Date = new Date()): string | null {
  const m = salePhase(now);
  if (!m) return null;
  const { window: w, phase } = m;
  const start = israelTime(w.liveFrom);
  const end = israelTime(w.liveTo);
  const en = language === 'en';
  const cm = saleWindows(w.liveFrom.getUTCFullYear()).find((x) => x.key === 'cyber_monday')!;
  const cmDay = israelTime(cm.liveFrom).date;
  // The close as a date, never "tomorrow": after midnight Israel, "until tomorrow 10:00"
  // names a day too late.
  const until = `עד ${end.date} ב-${end.time} שעון ישראל`;

  if (phase === 'live' && w.key === 'cyber_monday' && w.liveTo.getTime() - now.getTime() <= LAST_CALL_MS) {
    return en
      ? `Context: these are the last hours of Cyber Monday, the end of the Black Friday sales. Write it as a last chance: whoever put it off, now is the moment. ${NEVER_INVENT_EN}`
      : `הקשר: השעות האחרונות של סייבר מאנדיי, סוף מבצעי בלאק פריידיי, ${until}. כתוב כהזדמנות אחרונה: מי שדחה את הקנייה, זה הרגע. ${NEVER_INVENT_HE}`;
  }

  if (w.key === '1111' && phase === 'festival') {
    return en
      ? `Context: AliExpress's 11.11 sale, its biggest of the year, is still on. Make the 11.11 sale stand out in the post. ${NOT_LAST_CHANCE_EN} ${NEVER_INVENT_EN}`
      : `הקשר: מבצע 11.11 של אלי אקספרס, הגדול של השנה, עדיין פעיל. הדגש בפוסט שזה מבצע 11.11. ${NOT_LAST_CHANCE_HE} ${NEVER_INVENT_HE}`;
  }
  if (w.key === '1111') {
    return phase === 'warmup'
      ? (en
        ? `Context: AliExpress 11.11, its biggest sale of the year, is coming on November 11. When it fits, suggest saving the item to the cart or wishlist to catch it on the day. ${NEVER_INVENT_EN}`
        : `הקשר: מבצעי 11.11 של אלי אקספרס, הגדולים של השנה, נפתחים ב-11.11 ב-${start.time} שעון ישראל. כשזה מתאים, הצע לשמור את המוצר בעגלה או ברשימת המשאלות כדי לתפוס אותו ביום המבצע. ${NEVER_INVENT_HE}`)
      : (en
        ? `Context: AliExpress's 11.11 sale, its biggest of the year, is on now. Make the 11.11 sale stand out in the post. ${NOT_LAST_CHANCE_EN} ${NEVER_INVENT_EN}`
        : `הקשר: מבצע 11.11 של אלי אקספרס, הגדול של השנה, פעיל עכשיו. הדגש בפוסט שזה מבצע 11.11. ${NOT_LAST_CHANCE_HE} ${NEVER_INVENT_HE}`);
  }
  if (w.key === 'black_friday') {
    return phase === 'warmup'
      ? (en
        ? `Context: Black Friday and Cyber Monday are coming (from ${start.date}). When it fits, suggest saving the item to the cart to catch it then. ${NEVER_INVENT_EN}`
        : `הקשר: בלאק פריידיי (מ-${start.date}) וסייבר מאנדיי (${cmDay}) מתקרבים. כשזה מתאים, הצע לשמור את המוצר בעגלה כדי לתפוס אותו בסוף השבוע של המבצעים. ${NEVER_INVENT_HE}`)
      : (en
        ? `Context: it is Black Friday weekend, with Cyber Monday next. Frame the price as a Black Friday catch. ${NEVER_INVENT_EN}`
        : `הקשר: סוף השבוע של בלאק פריידיי, וסייבר מאנדיי ב-${cmDay}. מסגר את המחיר כהזדמנות של בלאק פריידיי. ${NEVER_INVENT_HE}`);
  }
  return en
    ? `Context: today is Cyber Monday, the last day of the Black Friday sales. Frame the deal as a last chance. ${NEVER_INVENT_EN}`
    : `הקשר: היום סייבר מאנדיי, היום האחרון של מבצעי בלאק פריידיי, ${until}. מסגר את הדיל כהזדמנות אחרונה. ${NEVER_INVENT_HE}`;
}

/** Days from `now` to a window's live start, on Israel calendar days (0 = today). */
export function israelDaysUntil(target: Date, now: Date = new Date()): number {
  const day = (d: Date) => new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(d)}T00:00:00Z`).getTime();
  return Math.round((day(target) - day(now)) / DAY_MS);
}
