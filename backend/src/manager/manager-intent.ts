/**
 * Is this owner message a question for the manager, or a product search?
 *
 * The owner bot has always treated a bare message as a search term, and that must keep
 * working: "אוזניות בלוטות'" is a search. A question reads differently — it asks, it ends
 * in "?", or it opens with an interrogative or an imperative like "תסביר". Those words do
 * not start product searches, so routing on them cannot steal one.
 *
 * Returns the question text, or null when the message should stay a search.
 */

const COMMANDS = new Set(['/ask', '/manager', '/m']);

/** Openers that make a message a question. A search term never starts with these. */
const OPENERS = new Set([
  'למה', 'מה', 'מהו', 'מהי', 'איך', 'כמה', 'מתי', 'האם', 'איזה', 'איזו', 'אילו', 'איפה', 'מדוע',
  'תסביר', 'הסבר', 'תסכם', 'סכם', 'תבדוק', 'בדוק', 'תראה', 'הראה', 'תגיד', 'ספר', 'תספר', 'תנתח', 'נתח',
  'why', 'what', 'how', 'when', 'which', 'explain', 'summarize', 'show',
]);

export function managerQuestion(raw: string): string | null {
  const text = String(raw || '').trim();
  if (!text) return null;

  if (text.startsWith('/')) {
    const [rawCmd, ...rest] = text.split(/\s+/);
    const cmd = rawCmd.split('@')[0].toLowerCase();
    if (!COMMANDS.has(cmd)) return null;
    return rest.join(' ').trim() || null;
  }

  if (/[?？]/.test(text)) return text;

  const words = text.split(/\s+/);
  if (words.length < 2) return null;
  // "בוקר טוב, תסביר לי…" — a greeting before the question still makes it a question.
  const first = words.slice(0, 3).map((w) => w.replace(/[^\p{L}]/gu, '').toLowerCase());
  return first.some((w) => OPENERS.has(w)) ? text : null;
}
