import axios from 'axios';

/**
 * When a Meta Page Access Token dies.
 *
 * Shared because there are TWO places that hold one: the account-level token in
 * credential_sets, and a per-group token on any channel publishing to its own Facebook page.
 * Only the first was ever tracked, so a group token could expire in silence and take that
 * group's Facebook and Instagram publishing with it — no banner, no email, just posts that
 * stopped working. Two copies of this lookup would have been two chances to drift apart on
 * a question ("is this token still good?") that has one right answer.
 */

const GRAPH_VERSION = process.env.GRAPH_VERSION || 'v21.0';

/**
 * The token's real expiry per Graph `debug_token` — a token can debug itself, so no app
 * secret is needed.
 *
 * Returns null both for a token that never expires (Graph reports `expires_at: 0`) and for
 * a lookup that failed, and callers must treat null as "unknown", never as "expired":
 * expiry tracking is a courtesy and must never block saving a credential or disable a
 * working integration because Graph was briefly unreachable.
 */
export async function resolveMetaTokenExpiry(token: string): Promise<Date | null> {
  if (!String(token || '').trim()) return null;
  try {
    const res = await axios.get(
      `https://graph.facebook.com/${GRAPH_VERSION}/debug_token`,
      { params: { input_token: token, access_token: token }, timeout: 8000, validateStatus: () => true },
    );
    const exp = res.data?.data?.expires_at;
    return typeof exp === 'number' && exp > 0 ? new Date(exp * 1000) : null;
  } catch {
    return null;
  }
}

/** Whole days until `exp`, floored. Negative once it has passed. Null stays null. */
export function daysUntil(exp: Date | null | undefined, now: Date = new Date()): number | null {
  if (!exp) return null;
  const ms = new Date(exp).getTime() - now.getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 86_400_000) : null;
}

/** The window in which a token is worth warning about — Meta's own tokens last ~60 days. */
export const TOKEN_WARN_DAYS = 7;

/** Should this token raise a warning now? Unknown expiry never warns (see above). */
export function tokenNeedsWarning(
  exp: Date | null | undefined, now: Date = new Date(), warnDays = TOKEN_WARN_DAYS,
): boolean {
  const days = daysUntil(exp, now);
  return days !== null && days <= warnDays;
}

/** What a Page token must carry to publish. Both "test" buttons judge against this list. */
export const PUBLISH_SCOPES = ['pages_manage_posts', 'pages_read_engagement'];

/**
 * Why a page/token pair was rejected, or that it was accepted. The caller words the remedy:
 * the two screens offer different ones (a channel can self-heal a user token; Settings says
 * what to go fix), but the QUESTION they ask Graph has one right answer.
 *
 * `problem` carries the outcome rather than a separate `ok` flag: this project compiles with
 * `strictNullChecks: false`, where a boolean literal does not narrow a union and every caller
 * would need a cast to read the fields it just proved were there.
 */
export type PageVerdict =
  | { problem: 'ok'; pageName: string }
  /** Graph refused to read the page at all — the raw payload, for the caller's own mapping. */
  | { problem: 'graph'; graphError: any }
  | { problem: 'user-token'; pageName: string }
  | { problem: 'scopes'; pageName: string; missing: string[] };

/**
 * Can this token publish to this Page?
 *
 * Ask the page for `name` ONLY. The obvious-looking `fields=name,tasks` is a trap: `tasks`
 * exists on the page node when a USER token asks, and not when a PAGE token does — so a
 * correct Page Access Token, the very thing we tell owners to paste, comes back as
 * `(#100) Tried accessing nonexisting field (tasks)`. The Settings → Integrations check did
 * exactly that and then advised "make sure the token is a Page Access Token", which is what
 * the owner had just done. It read as the system calling a correct setup wrong.
 *
 * Publish capability comes from `debug_token` instead (a token can debug itself), which
 * reports the token's type and granted scopes for both kinds of token.
 *
 * A failed debug_token lookup answers OK. "We could not check" must never be reported as
 * "your setup is broken" — the publish call stays the authority.
 *
 * Lives here, next to the expiry lookup, for the reason in this file's header: this question
 * is asked from two screens, and the copy that was not updated is the one that told the owner
 * the opposite of the truth.
 */
export async function verifyFacebookPage(pageId: string, token: string): Promise<PageVerdict> {
  const res = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${pageId}`, {
    params: { fields: 'name', access_token: token }, timeout: 6000, validateStatus: () => true,
  });
  if (res.data?.error) return { problem: 'graph', graphError: res.data.error };

  const pageName = String(res.data?.name || pageId);

  let info: { type: string; scopes: string[] } | null = null;
  try {
    const dbg = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/debug_token`, {
      params: { input_token: token, access_token: token }, timeout: 6000, validateStatus: () => true,
    });
    const data = dbg.data?.data;
    if (data && Array.isArray(data.scopes)) {
      info = { type: String(data.type || '').toUpperCase(), scopes: data.scopes as string[] };
    }
  } catch { /* lookup down — fall through to OK */ }

  if (!info) return { problem: 'ok', pageName };
  if (info.type === 'USER') return { problem: 'user-token', pageName };

  const missing = PUBLISH_SCOPES.filter((s) => !info.scopes.includes(s));
  return missing.length ? { problem: 'scopes', pageName, missing } : { problem: 'ok', pageName };
}
