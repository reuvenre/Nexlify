/**
 * Words the owner does not want published, and what goes out instead.
 *
 * The first rule: "ציד" (hunting) never reaches a channel — the groups sell tactical and
 * military gear, and the hunting framing is the owner's to decide, not the copy model's and
 * certainly not AliExpress's. It arrives from three directions at once (the model's own
 * phrasing, a supplier title echoed into the copy, an imported queue row), so asking the
 * model nicely is prevention, not a guarantee. This is the guarantee, applied once to the
 * finished body every channel is built from.
 *
 * Two things make this harder than a string replace, and both of them silently corrupt
 * real posts if they are missed.
 *
 * ── 1. "ציד" is a substring of an ordinary, unrelated word ──
 *
 * "צד" (side) inflects to צידו, צידה, צידי, and takes the same one-letter prefixes every
 * Hebrew word does: בצידו, לצידה, מצידי, הצידה ("aside"). Every one of them contains the
 * letters צ-י-ד. A naive replace turns "משקפת עם תאורה בצידה" into "…בטקטיה" — copy that
 * is not merely wrong but unreadable, published under the owner's affiliate identity.
 *
 * So a match must be a whole WORD. JavaScript's \b cannot say that here: \w is ASCII, so
 * \b sits between every Hebrew letter and none of them at once. The boundary is written
 * explicitly, as lookarounds for Hebrew letters, with the one-letter prefixes (ה ו ב ל מ ש כ)
 * consumed and handed back so "הציד" becomes "הטקטי" rather than losing its prefix.
 *
 * ── 2. The body contains URLs and HTML ──
 *
 * The affiliate link is inside the text by the time this runs, and a supplier URL can
 * legitimately read `.../1005006-hunting-knife.html`. Rewriting inside it breaks the link —
 * the click goes nowhere and the commission is lost, which is worse than the word. Anchors
 * (`<a href="…">`) are already in the body too. Both are stepped over, never rewritten.
 */

/** The Hebrew letter block, for writing word boundaries by hand. */
const HEB = 'א-ת';

/**
 * Hebrew's inseparable one-letter prefixes — ה ו ב ל מ ש כ.
 *
 * Consumed as part of the match and restored in the replacement: "ציוד לציד" must not lose
 * its ל. They are not part of the word, which is why they sit outside the boundary check.
 */
const PREFIX = '[הובלמשכ]?';

interface Rule {
  re: RegExp;
  /** `$1` in the replacement is the Hebrew prefix, or the empty string. */
  to: string;
}

/** A whole-word Hebrew rule: never matches inside a longer word, keeps any prefix. */
function hebrewWord(alternatives: string[], to: string): Rule {
  return {
    // Longest alternative first, so "צייד" is never matched as a prefix of "ציידים".
    re: new RegExp(`(?<![${HEB}])(${PREFIX})(?:${alternatives.join('|')})(?![${HEB}])`, 'g'),
    to: `$1${to}`,
  };
}

/** A whole-word Latin rule. \b is honest here — these really are ASCII words. */
function latinWord(alternatives: string[], to: string): Rule {
  return { re: new RegExp(`\\b(?:${alternatives.join('|')})\\b`, 'gi'), to };
}

/**
 * The policy. "טקטי" is the substitution rather than "צבאי" because it is the house word —
 * the group is literally named טקטי בקליק — and because it lands in the compound-noun shape
 * the word almost always appears in: "סכין ציד" → "סכין טקטי", "ציוד ציד" → "ציוד טקטי".
 *
 * The copy model is told the same rule in its brief (see defaultSystemPrompt), and is free
 * to choose צבאי where that reads better. This filter is the floor, not the author: it is
 * what runs when the model was not asked, was not listened to, or never saw the text at all.
 */
const RULES: Rule[] = [
  // The plural carries its own replacement: a rule that mapped every form onto one word
  // turned "ציידים" into the singular "טקטי" and left the sentence disagreeing with itself.
  hebrewWord(['ציידים'], 'טקטיים'),
  hebrewWord(['צייד', 'ציד'], 'טקטי'),
  latinWord(['hunting', 'hunters', 'hunter'], 'tactical'),
];

/** URLs and HTML tags — stepped over whole, never rewritten inside. */
const PROTECTED = /(https?:\/\/\S+|<[^>]+>)/g;

/** Apply every rule to one stretch of plain prose. */
function rewriteProse(prose: string): string {
  return RULES.reduce((acc, rule) => acc.replace(rule.re, rule.to), prose);
}

/**
 * The body, with the owner's vocabulary enforced.
 *
 * Idempotent, and safe to run on text that was never going to match: the overwhelmingly
 * common case is that nothing changes, and nothing should.
 */
export function applyWordPolicy(text: string): string {
  if (!text) return text;
  // Split on the protected spans so they survive untouched: String.split with a capturing
  // group returns the separators too, at every odd index.
  return text
    .split(PROTECTED)
    .map((part, i) => (i % 2 === 1 ? part : rewriteProse(part)))
    .join('');
}

/** Whether the policy would change this text — for logging what was caught, and for tests. */
export function violatesWordPolicy(text: string): boolean {
  return !!text && applyWordPolicy(text) !== text;
}

/**
 * The same rule, said to the copywriter model.
 *
 * The filter above guarantees the WORD never ships; only the model can guarantee the
 * SENTENCE reads well without it. Left to the filter alone, "אביזרי ציד" arrives as
 * "אביזרי טקטי" — correct by policy, clumsy in Hebrew. Told up front, the model writes
 * "אביזרים טקטיים" and the filter has nothing left to do, which is the intended steady state.
 *
 * Both words are offered because they are not interchangeable: a knife is טקטי, a surplus
 * jacket is צבאי, and the model is better placed to tell them apart than a lookup table.
 */
export const WORD_POLICY_BRIEF: Record<'he' | 'en', string> = {
  he: 'אוצר מילים — חובה: אסור להשתמש במילה "ציד" או "צייד" בשום צורה, גם אם היא מופיעה '
    + 'בשם המוצר או בתיאור שקיבלת. כתוב/כתבי במקומה "טקטי" או "צבאי" — מה שמתאים למוצר — '
    + 'והתאם/התאימי מין ומספר לשאר המשפט.',
  en: 'Vocabulary rule (mandatory): never use the words "hunting" or "hunter", even if they '
    + 'appear in the product title or description you were given. Write "tactical" or '
    + '"military" instead, whichever fits the product.',
};
