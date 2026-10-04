/**
 * The FLYLINK trust trailer — the fixed block that answers the question every follower
 * silently asks before clicking a hidden-product link: "מה באמת יגיע לי?".
 *
 * Replica shoppers hesitate for trust reasons, not interest reasons. The two facts that
 * actually reassure are already true — the Yupoo photos ARE the warehouse photos of the
 * exact item, and the seller answers questions in the group — so this block states them
 * on every FLYLINK post, built in CODE like the price/proof block: fixed wording that can
 * never over-promise, drift, or get "improved" into a claim we can't stand behind.
 *
 * Deliberately absent: delivery-time promises (we don't control logistics), "identical to
 * the original" (an expectation no replica should be sold on), and brand-authenticity
 * claims of any kind. Honest framing converts BETTER here: a buyer who expected a good
 * replica and got one recommends the group; a buyer promised the world is a refund.
 *
 * Appended at SEND time (buildPostBody), not stored in generated_text — so old queued
 * posts and verbatim re-posts pick it up too, and a wording tweak here reaches the whole
 * catalog at once.
 */

/** FLYLINK posts are identified by their link, same as the coupon filter does. */
export function isFlylinkPost(affiliateUrl: string | null | undefined): boolean {
  return /flylink/i.test(String(affiliateUrl || ''));
}

/** First line doubles as the dedup marker in buildPostBody — keep it stable. */
export const FLYLINK_TRUST_MARK = '✅ מה שבתמונה = מה שבקופסה';

/**
 * Marks earlier versions of this block used to open with.
 *
 * The first line IS the "already has a trailer" test, so changing it silently breaks that
 * test for every post carrying the old one — a verbatim re-post would be handed a second
 * trailer stacked on the first. Retiring a mark means keeping it here, never deleting it.
 */
export const FLYLINK_LEGACY_MARKS = ['📸 מהמפעל ישירות לצרכן'] as const;

/** Does this body already carry a trust trailer, in any version? */
export function hasFlylinkTrustBlock(body: string): boolean {
  const text = String(body || '');
  return text.includes(FLYLINK_TRUST_MARK) || FLYLINK_LEGACY_MARKS.some((m) => text.includes(m));
}

/** Where a post is going. Decides whether the replica line rides along. */
export type PostPlatform = 'telegram' | 'whatsapp' | 'facebook' | 'instagram' | 'pinterest';

/**
 * The owner's own wording. Says the thing out loud rather than letting a buyer discover
 * it after payment — the single biggest source of "this isn't what I ordered".
 */
export const FLYLINK_REPLICA_LINE = '🏷️ המוצר הינו רפליקה של המקור באיכות גבוהה';

/**
 * Which platforms carry the replica line.
 *
 * Only the owner's own group channels. Meta and Pinterest prohibit counterfeit and
 * replica goods outright, and a post that says "רפליקה" in plain Hebrew is the easiest
 * possible match for their automated enforcement — the line meant to protect the buyer
 * would be the thing that costs him the page. Unknown platform is treated as one of
 * those: the safe answer when we cannot tell where a post is going.
 */
const REPLICA_PLATFORMS = new Set<PostPlatform>(['telegram', 'whatsapp']);

export function showsReplicaLine(platform?: PostPlatform): boolean {
  return !!platform && REPLICA_PLATFORMS.has(platform);
}

/**
 * The trailer, written as an EXPECTATION CONTRACT.
 *
 * The previous version opened with "מהמפעל ישירות לצרכן — מה שרואים בתמונות זה מה שמגיע",
 * which is the sentence every dropshipper writes and therefore proves nothing. This one
 * states the deal in the buyer's own terms and then says why the photo can be trusted:
 * these are the warehouse shots OF THIS ITEM, not catalogue renders. That second line is
 * the whole asset — it is unusual, it is true, and it is the reason the first line is not
 * just a slogan.
 *
 * "צילומי המחסן של הפריט הזה" is as far as the claim goes on purpose. Not "לא מהיצרן"
 * (the warehouse may well be the manufacturer's), not a count of photos (a post can carry
 * one), not a delivery estimate. Every line here has to survive a buyer quoting it back.
 */
export function flylinkTrustBlock(platform?: PostPlatform, existingBody = ''): string {
  const lines: Array<{ text: string; covered: RegExp }> = [
    { text: `${FLYLINK_TRUST_MARK} — אותו פריט, אותו צבע, אותם פרטים`, covered: /מה שבתמונה|מה שרואים בתמונות/ },
    { text: '📸 אלה צילומי המחסן של הפריט הזה, לא תמונות קטלוג', covered: /צילומי המחסן|תמונות קטלוג|מהמפעל ישירות/ },
    // Right after the photo promise and before logistics: this is where a buyer decides
    // what he is actually buying.
    ...(showsReplicaLine(platform) ? [{ text: FLYLINK_REPLICA_LINE, covered: /רפליקה/ }] : []),
    { text: '📦 מספר מעקב ישירות למייל · משלוח מהיר', covered: /מספר מעקב/ },
    { text: '💬 שאלה לפני ההזמנה? שלחו הודעה לפרטי ונענה בשמחה', covered: /הודעה לפרטי/ },
  ];
  // A line whose point the post already makes is left out. FLYLINK templates carry their
  // own tracking/DM/photo lines, and stacking this block under them said everything twice
  // (the owner: "אורך מוגזם"). Every line is checked on its own, so the replica line —
  // the one fact a template never states — still goes out. Empty when nothing is missing.
  const body = String(existingBody || '');
  return lines.filter((l) => !l.covered.test(body)).map((l) => l.text).join('\n');
}

/**
 * The hidden-product notice, in one line.
 *
 * The owner's FLYLINK template spells it over three lines ("⚠️שימו לב מוצר מוסתר - בעמוד
 * המוצר יופיע פריט אחר. / יש לבחור צבע לפי הקוד בתמונות. / ומידה לפי טבלת המידות.").
 * The template lives in the database, and posts already queued carry the long form, so it
 * is compacted at send time — same as the rest of this file — to his own shorter wording.
 */
export const HIDDEN_PRODUCT_NOTICE = '⚠️ מוצר מוסתר: בעמוד יופיע פריט אחר — בחרו צבע לפי הקוד בתמונות ומידה לפי הטבלה';

const LONG_HIDDEN_NOTICE = /[‏‎]*⚠️\s*(?:שימו\s*לב[\s:,\-–—]*)?מוצר\s*מוסתר[\s\S]{0,220}?טבלת\s*המידות[.!]*/u;

export function compactHiddenProductNotice(body: string): string {
  return String(body || '').replace(LONG_HIDDEN_NOTICE, HIDDEN_PRODUCT_NOTICE);
}
