import axios from 'axios';
import { PUBLISH_SCOPES, TOKEN_WARN_DAYS, daysUntil, tokenNeedsWarning, verifyFacebookPage } from './meta-token';

/**
 * The rule that decides whether an owner gets woken about a Meta token.
 *
 * Its most important property is what it does with a token whose expiry is UNKNOWN — a
 * token that never expires, or one Graph could not be asked about. "Unknown" must read as
 * silence, never as "expired": the alternative is emailing someone that their publishing is
 * about to break because Graph had a bad minute.
 */
describe('daysUntil', () => {
  const NOW = new Date('2026-09-06T12:00:00Z');

  it('counts whole days ahead', () => {
    expect(daysUntil(new Date('2026-09-20T12:00:00Z'), NOW)).toBe(14);
    expect(daysUntil(new Date('2026-09-07T12:00:00Z'), NOW)).toBe(1);
  });

  it('goes negative once the token is already dead', () => {
    expect(daysUntil(new Date('2026-09-04T12:00:00Z'), NOW)).toBe(-2);
  });

  it('keeps null as null — unknown is not a number', () => {
    expect(daysUntil(null, NOW)).toBeNull();
    expect(daysUntil(undefined, NOW)).toBeNull();
  });
});

describe('tokenNeedsWarning', () => {
  const NOW = new Date('2026-09-06T12:00:00Z');

  it('warns inside the window and after expiry', () => {
    expect(tokenNeedsWarning(new Date('2026-09-10T12:00:00Z'), NOW)).toBe(true);   // 4 days
    expect(tokenNeedsWarning(new Date('2026-09-01T12:00:00Z'), NOW)).toBe(true);   // already gone
  });

  it('stays quiet on a healthy token', () => {
    expect(tokenNeedsWarning(new Date('2026-11-01T12:00:00Z'), NOW)).toBe(false);
  });

  it('flips exactly at the threshold, not a day early', () => {
    const boundary = new Date(NOW.getTime() + TOKEN_WARN_DAYS * 86_400_000);
    expect(tokenNeedsWarning(boundary, NOW)).toBe(true);
    expect(tokenNeedsWarning(new Date(boundary.getTime() + 86_400_000), NOW)).toBe(false);
  });

  it('NEVER warns on an unknown expiry', () => {
    // A token that does not expire reports null, and so does a Graph lookup that failed.
    // Treating either as "expiring" would email an owner that their publishing is about to
    // break — on no evidence at all.
    expect(tokenNeedsWarning(null, NOW)).toBe(false);
    expect(tokenNeedsWarning(undefined, NOW)).toBe(false);
  });
});

/**
 * Does this token let us publish to this Page? — asked from two screens, and for a while
 * answered differently by each.
 *
 * Settings → Integrations asked Graph for `fields=name,tasks`, reading `tasks` to decide
 * publish capability. That field is only on the page node when a USER token asks. Hand the
 * same request a correct PAGE ACCESS TOKEN — the very thing the UI tells owners to paste —
 * and Graph answers `(#100) Tried accessing nonexisting field (tasks)`, which the screen then
 * dressed up as "make sure the token is a Page Access Token". The owner had just done that.
 * The system was calling a correct setup wrong and naming the correct fix as the culprit.
 *
 * The per-channel test had already learned this and stopped asking for `tasks`. Nothing
 * carried the lesson across, which is the whole reason this check now lives in one place.
 */
describe('verifyFacebookPage', () => {
  const PAGE = '544344958755340';
  const TOKEN = 'EAAG-page-token';

  /** Graph, scripted: `page` answers the node read, `debug` answers debug_token. */
  function graph(page: any, debug?: any) {
    const get = jest.spyOn(axios, 'get').mockImplementation(async (url: string) =>
      (String(url).includes('debug_token') ? { data: debug } : { data: page }) as any);
    return get;
  }
  const scoped = (scopes: string[], type = 'PAGE') => ({ data: { type, scopes } });
  const ok = { name: 'טקטי בקליק' };

  afterEach(() => jest.restoreAllMocks());

  it('NEVER asks Graph for `tasks` — that field is what broke the correct token', () => {
    // The regression guard. If someone reintroduces it, a valid Page token starts failing
    // again and the message blames the owner for the one thing they got right.
    const get = graph(ok, scoped(PUBLISH_SCOPES));
    return verifyFacebookPage(PAGE, TOKEN).then(() => {
      const fields = String((get.mock.calls[0][1] as any)?.params?.fields || '');
      expect(fields).toBe('name');
      expect(fields).not.toContain('tasks');
    });
  });

  it('accepts a Page token that carries the publish scopes', async () => {
    graph(ok, scoped(PUBLISH_SCOPES));
    await expect(verifyFacebookPage(PAGE, TOKEN)).resolves.toEqual({
      problem: 'ok', pageName: 'טקטי בקליק',
    });
  });

  it('hands a Graph refusal back RAW, for the caller to word', async () => {
    // The two screens offer different remedies for the same refusal (one can list the
    // account's real page ids), so neither gets a pre-baked sentence from here.
    const error = { code: 100, message: 'Unsupported get request.' };
    graph({ error });
    await expect(verifyFacebookPage(PAGE, TOKEN)).resolves.toEqual({ problem: 'graph', graphError: error });
  });

  it('catches a USER token that can read the page but cannot post to it', async () => {
    // A name-only check without this would report a cheerful OK and then fail every post
    // with #200 — the false green that made this check necessary in the first place.
    graph(ok, scoped(['pages_show_list'], 'USER'));
    await expect(verifyFacebookPage(PAGE, TOKEN)).resolves.toEqual({
      problem: 'user-token', pageName: 'טקטי בקליק',
    });
  });

  it('names the scopes a Page token is missing rather than just failing it', async () => {
    graph(ok, scoped(['pages_read_engagement']));
    await expect(verifyFacebookPage(PAGE, TOKEN)).resolves.toEqual({
      problem: 'scopes', pageName: 'טקטי בקליק', missing: ['pages_manage_posts'],
    });
  });

  it('answers OK when debug_token is unreachable — publish stays the authority', async () => {
    // "We could not check" must never reach the owner as "your setup is broken". A bad
    // minute at Graph would otherwise tell someone their working integration has failed.
    graph(ok, { error: { message: 'down' } });
    await expect(verifyFacebookPage(PAGE, TOKEN)).resolves.toEqual({ problem: 'ok', pageName: 'טקטי בקליק' });
  });

  it('falls back to the page id when Graph returns no name', async () => {
    graph({}, scoped(PUBLISH_SCOPES));
    await expect(verifyFacebookPage(PAGE, TOKEN)).resolves.toEqual({ problem: 'ok', pageName: PAGE });
  });
});
