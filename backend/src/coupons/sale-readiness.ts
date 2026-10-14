import {
  MIN_SALE_INTERVAL_MIN, SaleWindow, israelDaysUntil, israelTime, saleWindows,
} from '../common/sale-calendar';

/**
 * The checklist the owner gets a week and two days before each big sale (11.11, Black
 * Friday with Cyber Monday). The days are the year's money, and what decides them is set
 * up before: the sale's coupon codes, an AI key with credit, campaigns that actually post.
 * Finding a dead key on the morning of 11.11 costs the whole day.
 */

/** Days before a sale's live start that the checklist goes out. */
export const READINESS_DAYS = [7, 2];

export interface ReadinessFacts {
  /** Active coupons whose window overlaps the sale. */
  couponsForSale: number;
  activeCampaigns: number;
  /** Active campaigns whose last run note names a refused key or an empty AI balance. */
  aiFailing: string[];
  postsLast24h: number;
  seasonalEnabled: boolean;
}

/** The sale whose checklist is due on `now`'s Israel day, with how many days remain. */
export function readinessDue(now: Date = new Date()): { window: SaleWindow; days: number } | null {
  const year = now.getUTCFullYear();
  for (const w of saleWindows(year)) {
    // Cyber Monday is the tail of Black Friday's weekend; one checklist covers both.
    if (w.key === 'cyber_monday') continue;
    const days = israelDaysUntil(w.liveFrom, now);
    if (READINESS_DAYS.includes(days)) return { window: w, days };
  }
  return null;
}

/** The next sale (or the one live now) with the Israel days to its start, for /sale. */
export function nextSale(now: Date = new Date()): { window: SaleWindow; days: number } {
  const year = now.getUTCFullYear();
  const all = [...saleWindows(year), ...saleWindows(year + 1)].filter((w) => w.key !== 'cyber_monday');
  // Black Friday's checklist covers Cyber Monday, so its weekend counts as "live" to the end.
  const end = (w: SaleWindow) => (w.key === 'black_friday' ? w.liveTo.getTime() + 86_400_000 : w.liveTo.getTime());
  const w = all.find((x) => end(x) > now.getTime())!;
  return { window: w, days: Math.max(0, israelDaysUntil(w.liveFrom, now)) };
}

/** The note patterns that mean the copywriter cannot write (ai/ai-failure.ts wording). */
export function aiFailureNote(note: string | null | undefined): boolean {
  return /נגמר הקרדיט|המפתח נדחה|credit balance|invalid x-api-key/i.test(String(note || ''));
}

/** The checklist text, in Hebrew. */
export function readinessReport(window: SaleWindow, days: number, f: ReadinessFacts): string {
  const from = israelTime(window.liveFrom);
  const to = israelTime(window.liveTo);
  const cm = window.key === 'black_friday'
    ? saleWindows(window.liveFrom.getUTCFullYear()).find((w) => w.key === 'cyber_monday')
    : null;
  const span = cm
    ? `${from.date} ${from.time} עד ${israelTime(cm.liveTo).date} ${israelTime(cm.liveTo).time}, כולל סייבר מאנדיי`
    : `${from.date} ${from.time} עד ${to.date} ${to.time}`;
  const ok = (b: boolean) => (b ? '✅' : '⚠️');

  const lines = [
    `🛒 ${days > 0 ? `עוד ${days} ימים` : 'היום'}: ${window.name} (${span}, שעון ישראל)`,
    '',
    'בדיקת מוכנות:',
    f.couponsForSale
      ? `${ok(true)} קופונים: ${f.couponsForSale} קודים פעילים לתקופת המבצע.`
      : `${ok(false)} קופונים: אין קודים לתקופת המבצע. כשאלי אקספרס מפרסמת את הקודים בפורטל השותפים, הדבק אותם במסך הקופונים עם תאריכי המבצע, והמערכת תבנה רצף פוסטים (טיזר, פתיחה, אמצע, דקות אחרונות).`,
    f.aiFailing.length
      ? `${ok(false)} AI: ${f.aiFailing.length} קמפיינים נכשלו בכתיבה בהרצה האחרונה (${f.aiFailing.slice(0, 3).join(', ')}). בדוק את מפתח ה-AI והקרדיט לפני יום המבצע.`
      : `${ok(true)} AI: אין שגיאות מפתח או קרדיט בהרצות האחרונות.`,
    `${ok(f.activeCampaigns > 0 && f.postsLast24h > 0)} פרסום: ${f.activeCampaigns} קמפיינים פעילים, ${f.postsLast24h} פוסטים יצאו ב-24 השעות האחרונות.`,
    f.seasonalEnabled
      ? `${ok(true)} לוח העונות פעיל: הפוסטים כבר מנוסחים לפי שלב המבצע.`
      : `${ok(false)} לוח העונות כבוי (הגדרות ← תזמון). בלעדיו הפוסטים לא מזכירים את המבצע ואין האצה ביום עצמו.`,
    '',
    `⚡ ביום המבצע כל קמפיין יפרסם בערך פי 2: כפול פוסטים בכל הרצה, וחצי מהמרווח בקבוצה (לא פחות מ-${MIN_SALE_INTERVAL_MIN} דקות).`,
  ];
  return lines.join('\n');
}
