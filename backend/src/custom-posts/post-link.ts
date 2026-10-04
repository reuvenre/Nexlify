/**
 * The clickable destination of a hand-written scheduled post.
 *
 * Every autopilot post carries its link in `affiliate_url`, which is what earns it a
 * tracked /r/<code> — and therefore what makes its clicks countable. A scheduled post is
 * typed by the owner, so its link sits in the middle of the prose and the row went out with
 * an empty `affiliate_url`: the post published fine and then vanished from every number the
 * account keeps. A holiday campaign the owner writes by hand is exactly the post he most
 * wants to measure.
 *
 * So the body is read once at dispatch and its first link becomes the post's destination,
 * after which the ordinary publish path treats it like any other post — mints the code,
 * lifts the raw URL out of the text, and re-attaches it as the standard "🔗" call to action.
 */

/**
 * URLs end where whitespace begins; trailing punctuation is prose, not address.
 *
 * The closing bracket is only trailing when it is unmatched — Wikipedia-style URLs really
 * do end in one, and stripping it blindly would break the link the owner pasted.
 */
const URL_RE = /https?:\/\/[^\s<>"']+/i;
const TRAILING = /[.,;:!?…"'׳״]+$/;

export function firstLink(body: string | null | undefined): string | null {
  const match = URL_RE.exec(String(body || ''));
  if (!match) return null;

  let url = match[0].replace(TRAILING, '');
  // Strip a trailing ) or ] only when nothing opened it inside the URL.
  for (const [open, close] of [['(', ')'], ['[', ']']] as const) {
    while (url.endsWith(close)) {
      const opens = url.split(open).length - 1;
      const closes = url.split(close).length - 1;
      if (closes <= opens) break;
      url = url.slice(0, -1);
    }
  }
  // An HTML anchor in the body ends the href at the quote, already handled by URL_RE's
  // character class. What can still trail is a stray '&quot;' style entity tail.
  url = url.replace(/&(?:quot|amp|lt|gt|#\d+);+$/i, '');
  return url || null;
}

/**
 * `[text](https://…)` in a hand-written post → a Telegram anchor that shows only the text.
 *
 * The owner writes on a phone, where an HTML anchor is unreasonable to type, and a bare URL
 * pasted into the prose was lifted out and re-attached as the product post's "🛒 לרכישה"
 * button — the wrong words for an announcement. This form keeps the link exactly where he
 * put it, behind exactly the words he chose. `links` tells the dispatcher the post placed
 * its own links, so none is lifted out.
 */
const MD_LINK = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)/g;

export function markdownLinksToHtml(body: string | null | undefined): { html: string; links: string[] } {
  const links: string[] = [];
  const html = String(body || '').replace(MD_LINK, (_m, text: string, url: string) => {
    links.push(url);
    const safeText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeUrl = url.replace(/"/g, '%22');
    return `<a href="${safeUrl}">${safeText}</a>`;
  });
  return { html, links };
}
