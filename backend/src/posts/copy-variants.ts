/**
 * Learning HOW to write, not just what to post.
 *
 * The optimizer learns which products and categories to publish. It never had an opinion
 * about the copy — every post was written in one voice forever, so the one thing the
 * audience actually reads was the one thing that never improved.
 *
 * This is a bandit over a handful of copy angles. Each campaign post is written in one of
 * them, the angle is recorded on the post, and clicks per post per angle say which one that
 * group responds to. Mostly the engine writes in the angle that wins for that group; some of
 * the time it deliberately tries another, because an angle that is never used can never be
 * discovered to be better.
 *
 * Two rules keep it honest, both learned from the keyword loop:
 *   • Nothing is declared a winner on a handful of clicks. Below the evidence floor the
 *     engine keeps exploring rather than locking onto noise.
 *   • The angle is a nudge to the copywriter, never a replacement for it — and it is
 *     skipped entirely for a group with its own template, whose wording is the owner's.
 */

/** One copy angle: an id stored on the post, and the nudge handed to the copywriter. */
export interface CopyVariant {
  id: string;
  /** Short Hebrew label for the digest. */
  label: string;
  /** The instruction appended to the system prompt, per language. */
  hint: Record<string, string>;
}

/**
 * The angles in play. Deliberately few and clearly distinct — a bandit over twenty
 * near-identical options would need traffic this account does not have to tell any of them
 * apart. Retiring the two that measured zero (below) is the same argument applied again:
 * fewer angles means each survivor gets more airtime and reaches an answer sooner.
 */
export const COPY_VARIANTS: CopyVariant[] = [
  {
    id: 'benefit',
    label: 'תועלת',
    hint: {
      he: 'זווית כתיבה: פתח/י במה שהמוצר עושה עבור הקורא בחיי היום-יום — התועלת הקונקרטית, לא המפרט.',
      en: 'Copy angle: open with what the product does for the reader day to day — the concrete benefit, not the spec sheet.',
      ar: 'زاوية الكتابة: ابدأ بما يقدمه المنتج للقارئ في حياته اليومية — الفائدة الملموسة وليس المواصفات.',
    },
  },
  {
    id: 'value',
    label: 'מחיר',
    hint: {
      he: 'זווית כתיבה: הדגש/י מוקדם את העסקה עצמה — כמה זה עולה מול מה שמקבלים. ענייני, בלי לחץ מלאכותי.',
      en: 'Copy angle: lead with the deal itself — what it costs against what you get. Matter-of-fact, no artificial pressure.',
      ar: 'زاوية الكتابة: ابدأ بالصفقة نفسها — الثمن مقابل ما تحصل عليه. بشكل واقعي وبلا ضغط مصطنع.',
    },
  },
];

/**
 * Angles no longer written, kept so history stays readable.
 *
 * Measured over ~200 posts: כאב 0 clicks in 49 posts, סקרנות 0 in 42 — against מחיר 0.13
 * per post and תועלת 0.033. Zero is not a low score to keep exploring around; two angles
 * that produced nothing across ninety posts were spending a quarter of the airtime each on
 * a question already answered. Retiring them hands that airtime to the two that work.
 *
 * DELETING them would have been the obvious move and the wrong one: variantById backs the
 * owner's own reports, and a stored post carrying 'problem' would start rendering as
 * "סגנון קודם" — quietly erasing the evidence this decision was made on. They stay
 * resolvable, they are simply never chosen.
 */
export const RETIRED_VARIANTS: CopyVariant[] = [
  {
    id: 'problem',
    label: 'כאב',
    hint: {
      he: 'זווית כתיבה: פתח/י בתיאור קצר של המצב המעצבן שהמוצר פותר, ורק אחר כך הצג/י אותו כפתרון.',
      en: 'Copy angle: open with the small everyday annoyance this product solves, then present it as the fix.',
      ar: 'زاوية الكتابة: ابدأ بوصف قصير للمشكلة اليومية التي يحلها المنتج، ثم قدّمه كحل.',
    },
  },
  {
    id: 'curiosity',
    label: 'סקרנות',
    hint: {
      he: 'זווית כתיבה: פתח/י בשורה שמעוררת סקרנות או בשאלה קצרה שגורמת לקורא לרצות לראות את המוצר. בלי קליקבייט ובלי הבטחות שאינן נכונות.',
      en: 'Copy angle: open with a curiosity hook or a short question that makes the reader want to look. No clickbait, no promises that are not true.',
      ar: 'زاوية الكتابة: ابدأ بجملة تثير الفضول أو بسؤال قصير يدفع القارئ للاطلاع. بلا مبالغة وبلا وعود غير صحيحة.',
    },
  },
];

/**
 * FLYLINK-only angle: speak straight to the replica-fear instead of around it.
 *
 * Hidden-product followers hesitate for trust reasons, not interest reasons — and copy
 * that pretends there is nothing to address amplifies the suspicion. This angle answers
 * it with confidence and WITHOUT crossing the honesty line: never claim the product is
 * original, never promise "identical to the original", never name a brand as the source.
 * Kept out of the AliExpress pool where "כן, זו גרסה" would be flatly wrong.
 */
export const TRUST_VARIANT: CopyVariant = {
  id: 'trust',
  label: 'ביטחון',
  hint: {
    he: 'זווית כתיבה: פנה/י בביטחון ובלי התנצלות לשאלה שהקורא שואל בלב — "מה באמת יגיע לי?". הדגש/י את איכות הגרסה, את זה שהתמונות הן של הפריט עצמו, ואת הפער האדיר מול מחיר המקור. אסור לטעון שהמוצר מקורי, אסור להבטיח "זהה למקור", ואסור להציג מותג כמקור המוצר.',
    en: 'Copy angle: address the reader\'s unspoken question — "what will I actually get?" — with confidence, not apology. Stress the version\'s quality, that the photos show the actual item, and the gap versus the original\'s price. Never claim it is original, never promise "identical to the original", never present a brand as the source.',
    ar: 'زاوية الكتابة: أجب بثقة وبلا اعتذار عن سؤال القارئ الصامت — "ماذا سيصلني فعلاً؟". أبرز جودة النسخة وأن الصور للقطعة نفسها والفارق مقابل سعر الأصلي. لا تدّعِ أبداً أن المنتج أصلي ولا تعد بأنه "مطابق للأصل".',
  },
};

/** The pool a FLYLINK campaign draws from — the shared angles plus the trust angle. */
export const FLYLINK_VARIANTS: CopyVariant[] = [...COPY_VARIANTS, TRUST_VARIANT];

/** Clicks and posts recorded for one angle, in one campaign. */
export interface VariantStat {
  variant: string;
  posts: number;
  clicks: number;
}

/** An angle ranked by how well it actually performed for this group. */
export interface VariantScore extends VariantStat {
  /** Clicks per post — the comparable number, since angles get unequal airtime. */
  clicksPerPost: number;
}

/** Posts an angle needs before its rate means anything at all. */
export const MIN_POSTS_PER_VARIANT = 8;
/** Clicks a campaign needs across all angles before any of them can be called the winner.
 *  Same principle as the keyword loop: silence is not a verdict. */
export const MIN_CLICKS_TO_PICK_WINNER = 15;
/** How often to write in an angle other than the leader, once there IS a leader. Without
 *  this the first lucky angle wins forever and the rest are never measured again. */
export const EXPLORE_RATE = 0.25;

/** Rank the angles for one campaign by clicks per post, best first. */
export function scoreVariants(stats: VariantStat[]): VariantScore[] {
  return (stats || [])
    .filter((s) => s && s.posts > 0)
    .map((s) => ({
      variant: s.variant,
      posts: s.posts,
      clicks: s.clicks,
      clicksPerPost: +(s.clicks / s.posts).toFixed(3),
    }))
    .sort((a, b) => (b.clicksPerPost - a.clicksPerPost) || (b.posts - a.posts));
}

/**
 * The angle that has earned the right to be called this group's best — or null when the
 * evidence does not support naming one yet.
 *
 * Requires three things together: enough clicks across the campaign to be measuring
 * something, enough posts behind the leader for its rate to be real, and at least one click.
 * Any of them missing means there is no winner, only a front-runner, and the caller keeps
 * exploring.
 */
export function bestVariant(stats: VariantStat[]): VariantScore | null {
  const scored = scoreVariants(stats);
  if (!scored.length) return null;
  const totalClicks = scored.reduce((n, s) => n + s.clicks, 0);
  if (totalClicks < MIN_CLICKS_TO_PICK_WINNER) return null;
  const top = scored[0];
  if (top.posts < MIN_POSTS_PER_VARIANT || top.clicks === 0) return null;
  return top;
}

/**
 * Choose the angle for the next post.
 *
 * An angle that has not had its fair chance yet is always taken first — the bandit cannot
 * compare options it has never tried. After that it writes in the winner, except for an
 * explore share that keeps the others measured and lets a better angle overtake a stale one.
 *
 * `roll` is the caller's random draw, passed in so this stays a pure function.
 */
export function pickVariant(stats: VariantStat[], roll: number, pool: CopyVariant[] = COPY_VARIANTS): CopyVariant {
  // Only angles this pool can actually write get a say. A retired angle keeps its history in
  // `stats` for the owner's reports, and must not be able to win a race it can no longer
  // run: bestVariant would name it, the lookup below would miss it, and every post would
  // quietly fall back to pool[0] — exploration dead, and for an invisible reason.
  const live = (stats || []).filter((s) => pool.some((v) => v.id === s.variant));
  const byId = new Map(live.map((s) => [s.variant, s]));

  // Anything under-sampled goes first, so every angle gets a real trial before any
  // comparison between them is allowed to mean something.
  const untried = pool.filter((v) => (byId.get(v.id)?.posts || 0) < MIN_POSTS_PER_VARIANT);
  if (untried.length) return untried[Math.floor(roll * untried.length) % untried.length];

  const winner = bestVariant(live);
  if (!winner || roll < EXPLORE_RATE) {
    return pool[Math.floor(roll * pool.length) % pool.length];
  }
  return pool.find((v) => v.id === winner.variant) || pool[0];
}

/** The copywriter nudge for an angle, in the post's language (English is the fallback). */
export function variantHint(variant: CopyVariant, language: string): string {
  const lang = (language || 'he').toLowerCase().slice(0, 2);
  return variant.hint[lang] || variant.hint.en;
}

/** An angle by id — for turning a stored post value back into something displayable. */
/**
 * The Hebrew name of a copy angle, for anything the OWNER reads.
 *
 * `variantById(id)?.label || id` was the old formula, and it leaks a raw English id into a
 * Hebrew report the moment a post carries an angle the catalog no longer lists — a renamed
 * or retired variant on an older post. The id means nothing to the reader; say plainly that
 * it is an older style instead.
 */
export function variantLabel(id: string): string {
  return variantById(id)?.label || 'סגנון קודם';
}

export function variantById(id: string | null | undefined): CopyVariant | null {
  if (!id) return null;
  // Search every pool INCLUDING the retired one — a stored 'trust', 'problem' or 'curiosity'
  // post must still resolve to its Hebrew label in the owner's reports. What we stopped
  // writing is separate from what we can still read.
  return [...FLYLINK_VARIANTS, ...RETIRED_VARIANTS].find((v) => v.id === id) || null;
}
