import type { Metadata } from 'next';
import { MarketingShell } from '@/components/marketing/MarketingShell';

export const metadata: Metadata = {
  title: 'הצהרת נגישות',
  description: 'הצהרת הנגישות של Nexlify מבית Win Solutions: מה נעשה כדי שהאתר יהיה נגיש, מגבלות ידועות ודרכי פנייה.',
  alternates: { canonical: '/accessibility' },
};

/** Last time the site was reviewed for accessibility. Update with every review. */
const REVIEWED = '17 באוקטובר 2026';

/**
 * The accessibility statement (הצהרת נגישות).
 *
 * It states what was actually done and what is still known to be missing, never a claim
 * of full conformance: the site has not had an external expert audit. Keep the "known
 * limitations" list honest — remove an item only when it is fixed.
 */
export default function AccessibilityPage() {
  return (
    <MarketingShell>
      <section className="max-w-3xl mx-auto px-6 pt-14 pb-10">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-2">הצהרת נגישות</h1>
        <p className="text-sm text-white/60 mb-10">Nexlify מבית Win Solutions · עודכן לאחרונה: {REVIEWED}</p>

        <div className="space-y-8 text-[15px] leading-relaxed text-white/80">
          <div>
            <h2 className="text-lg font-semibold text-white mb-2">המחויבות שלנו</h2>
            <p>
              אנחנו רוצים שכל אחד יוכל להשתמש ב-Nexlify, כולל אנשים עם מוגבלות. אנחנו פועלים להתאים את
              האתר להנחיות הנגישות לתוכן אינטרנט WCAG 2.1 ברמה AA, שעליהן מבוסס התקן הישראלי ת&quot;י 5568.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-white mb-2">מה עשינו</h2>
            <ul className="list-disc ps-5 space-y-1.5">
              <li>האתר בנוי בעברית מימין לשמאל, עם הגדרת שפה וכיוון לכל הדף.</li>
              <li>קישור «דלג לתוכן הראשי» בראש כל דף, ומבנה כותרות היררכי.</li>
              <li>ניווט מלא במקלדת, עם סימון פוקוס בולט על כל רכיב פעיל.</li>
              <li>טקסט חלופי לתמונות שמעבירות מידע, וסימון תמונות וסמלים דקורטיביים כך שקוראי מסך ידלגו עליהם.</li>
              <li>תווית לכל שדה בטופס, ושם ברור לכל כפתור וקישור, כולל כפתורים שמוצג בהם סמל בלבד.</li>
              <li>הודעות שגיאה בטפסי הכניסה וההרשמה מוקראות לקוראי מסך.</li>
              <li>חלונות קופצים נפתחים עם פוקוס בתוכם ונסגרים במקש Esc.</li>
              <li>שיפור ניגודיות הטקסט המשני.</li>
              <li>באנר העוגיות נגיש במקלדת ובקוראי מסך, וכל האפשרויות בו מוצגות באותה בולטות.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-white mb-2">מגבלות ידועות</h2>
            <p className="mb-2">למרות המאמץ, ייתכן שחלקים באתר עדיין אינם נגישים במלואם. ידוע לנו על:</p>
            <ul className="list-disc ps-5 space-y-1.5">
              <li>תמונות מוצרים שמגיעות מספקים חיצוניים (AliExpress וקטלוגי ספקים) מתוארות לפי שם המוצר, ולא תמיד לפי מה שרואים בתמונה.</li>
              <li>חלק מהגרפים בלוח הבקרה מציגים מידע בצורה חזותית בלבד. הנתונים עצמם מוצגים גם כמספרים בכרטיסים שמעל הגרף.</li>
              <li>סרטוני מוצרים מקטלוגי ספקים מוצגים כפי שהספק העלה אותם, ללא כתוביות.</li>
              <li>האתר טרם עבר בדיקת נגישות של מומחה חיצוני.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-white mb-2">נתקלתם בבעיה?</h2>
            <p>
              אם משהו באתר לא נגיש לכם, נשמח לדעת ולתקן. כתבו לנו לכתובת{' '}
              <a href="mailto:rubypc6@gmail.com" className="text-blue-400 underline hover:text-blue-300">rubypc6@gmail.com</a>{' '}
              ופרטו באיזה דף מדובר, מה ניסיתם לעשות, ובאיזה דפדפן ובאיזו טכנולוגיה מסייעת השתמשתם. נחזור אליכם בהקדם.
            </p>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
