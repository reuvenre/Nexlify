import {
  facebookError, facebookErrorText, isTransientFacebookError, isMetaConnectionError,
  isMetaTimeoutError, metaGraphError,
} from './facebook-errors';

const graph = (code: number, message: string, error_subcode?: number) =>
  ({ response: { data: { error: { code, message, ...(error_subcode ? { error_subcode } : {}) } } } });

describe('facebookError', () => {
  it('replaces the #200 permissions essay with the one action that fixes it', () => {
    // The real message enumerates every branch of the permission model in English and never
    // says which one applies — useless in a Hebrew UI.
    const info = facebookError(graph(200,
      'If posting to a group, requires app being installed in the group, and either '
      + 'publish_to_groups permission with user token, or both pages_read_engagement and '
      + 'pages_manage_posts permission with page token; If posting to a page, requires both '
      + 'pages_read_engagement and pages_manage_posts as an admin',
    ));
    expect(info.message).toContain('Page Access Token');
    expect(info.message).toContain('pages_manage_posts');
    expect(info.message).not.toContain('If posting');
    expect(info.needsUserAction).toBe(true);
  });

  it('flags an expired token as the owner\'s to renew', () => {
    expect(facebookError(graph(190, 'Session has expired')).needsUserAction).toBe(true);
  });

  it('calls #1 "reduce the amount of data" what it is — a transient server blip, not a settings problem', () => {
    // The exact partial-publish from the watchdog: Graph rejected a photo post under load
    // and asked to retry. Nothing on the owner's side is wrong.
    const info = facebookError(graph(1, "Please reduce the amount of data you're asking for, then retry your request"));
    expect(info.needsUserAction).toBe(false);
    expect(info.message).toContain('זמנית');
    expect(info.message).toContain('reduce the amount of data'); // raw kept for traceability
  });

  describe('#190 subcodes each need a different owner action', () => {
    it('says a password change killed every old token, so re-pasting one is pointless', () => {
      // The generic "renew the token" wording had the owner re-paste a token from the very
      // session Facebook invalidated — it fails identically every time.
      const info = facebookError(graph(190,
        'Error validating access token: The session has been invalidated because the user '
        + 'changed their password or Facebook has changed the session for security reasons.',
        460,
      ));
      expect(info.message).toContain('שינוי סיסמה');
      expect(info.message).toContain('להתחבר מחדש');
      expect(info.needsUserAction).toBe(true);
    });

    it('points a de-authorized app at the consent screen, not at a token field', () => {
      expect(facebookError(graph(190, 'App not authorized', 458)).message).toContain('האפליקציה הוסרה');
    });

    it('names the admin problem when the token holder is not a page admin', () => {
      expect(facebookError(graph(190, 'Not an admin', 492)).message).toContain('אינו אדמין');
    });

    it('keeps the generic renew message when no subcode narrows it down', () => {
      expect(facebookError(graph(190, 'Session has expired')).message).toContain('פג תוקף או בוטל');
    });
  });

  it('does not send the owner to Settings for a rate limit', () => {
    // #4 clears on its own; telling the user to change a token would be a wild goose chase.
    const info = facebookError(graph(4, 'Application request limit reached'));
    expect(info.needsUserAction).toBe(false);
    expect(info.message).toContain('בריצה הבאה');
  });

  it('keeps the raw text for codes it does not recognise', () => {
    // Swallowing an unknown failure into a generic message would hide the only clue.
    expect(facebookError(graph(999, 'Some brand new failure')).message).toBe('Some brand new failure');
  });

  it('passes through a non-Graph failure it has no mapping for', () => {
    // Network-level errors carry no code; anything that isn't a recognised timeout keeps
    // its text so an unfamiliar failure stays visible.
    expect(facebookError(new Error('socket hang up')).message).toBe('socket hang up');
  });

  it('prefixes the code so a report stays traceable', () => {
    expect(facebookErrorText(graph(190, 'x'))).toMatch(/^\(#190\)/);
  });

  describe('#10 means different things per surface', () => {
    const err = graph(10, 'Application does not have permission for this action');

    it('points Instagram at the publishing permission it actually needs', () => {
      const info = facebookError(err, 'instagram');
      expect(info.message).toContain('instagram_content_publish');
      // The account granted instagram_manage_events and assumed it covered publishing.
      expect(info.message).toContain('instagram_manage_events');
      expect(info.message).not.toContain('Page Access Token');
    });

    it('keeps the Page-token guidance for Facebook', () => {
      expect(facebookError(err, 'facebook').message).toContain('Page Access Token');
    });
  });

  it('treats a client timeout as transient, not as a settings problem', () => {
    // Graph scrapes the attached link before answering, so a slow round trip is normal —
    // sending the owner to re-issue a token for it would be a wild goose chase.
    const info = facebookError(new Error('timeout of 8000ms exceeded'));
    expect(info.needsUserAction).toBe(false);
    expect(info.message).toContain('לא השיבה בזמן');
  });
});

describe('#100 — Graph\'s generic "invalid parameter"', () => {
  const err100 = (message: string) => ({ response: { data: { error: { code: 100, message } } } });

  it('names the Page ID when Graph says the object cannot be reached', () => {
    const info = facebookError(err100(
      "Unsupported post request. Object with ID '123' does not exist, cannot be loaded due to "
      + 'missing permissions, or does not support this operation.',
    ));
    expect(info.message).toContain('Page ID');
    expect(info.message).toContain('/me/accounts');
    expect(info.needsUserAction).toBe(true);
  });

  it('blames the LINK when Graph says the link is what it rejected', () => {
    // The same code fires for a bad `link`, and sending the owner to re-check a correct
    // Page ID leaves the real culprit untouched.
    const info = facebookError(err100('Invalid parameter: link URL is not properly formatted'));
    expect(info.message).toContain('קישור');
    expect(info.message).not.toContain('/me/accounts');
  });

  it('quotes Facebook verbatim for a flavour it does not recognise', () => {
    // Guessing a cause reads as certainty the code does not have. Say what Facebook said.
    const info = facebookError(err100('Invalid parameter: some future field'));
    expect(info.message).toContain('Invalid parameter: some future field');
    expect(info.message).toContain('Page ID'); // still names the most common cause
  });

  it('applies the same reading to #803', () => {
    expect(facebookError({ response: { data: { error: { code: 803, message: 'does not exist' } } } })
      .message).toContain('Page ID');
  });
});

/**
 * Watchdog #72: "Facebook: (#200) אין הרשאת פרסום לדף. נדרש Page Access Token…" — a perfect
 * instruction with no address. On an account publishing to several pages it says exactly
 * what to do and not where, and the send path knew the page id all along.
 */
describe('naming the page the owner has to go fix', () => {
  const PAGE = '1015551234567';

  it('names the page on a failure only the owner can clear', () => {
    const info = facebookError(graph(200, 'permissions essay'), 'facebook', PAGE);
    expect(info.needsUserAction).toBe(true);
    expect(info.message).toContain(PAGE);
  });

  it('names it for an expired token too — the commonest "which page?" of all', () => {
    expect(facebookError(graph(190, 'Session has expired'), 'facebook', PAGE).message).toContain(PAGE);
  });

  it('stays SILENT about the page on a transient blip', () => {
    // #1/#2 need no address: nothing is broken and there is nowhere to go.
    const info = facebookError(graph(2, 'unexpected error'), 'facebook', PAGE);
    expect(info.needsUserAction).toBe(false);
    expect(info.message).not.toContain(PAGE);
  });

  it('reads exactly as before when no page is passed', () => {
    // Every existing caller and every stored message keeps its wording.
    expect(facebookError(graph(200, 'x'), 'facebook'))
      .toEqual(facebookError(graph(200, 'x'), 'facebook', ''));
    expect(facebookError(graph(200, 'x'), 'facebook', '   ').message).not.toContain('(דף');
  });

  it('carries through to the one-line report', () => {
    expect(facebookErrorText(graph(200, 'x'), 'facebook', PAGE)).toContain(PAGE);
  });
});

/**
 * Naming the page was half the address. The other half is WHICH SCREEN holds the token that
 * just failed — and the two screens are not interchangeable: a group carrying its own Page
 * token overrides the account-level one, so the send path never reads Settings → Integrations
 * for that group. Watchdog #73 was a #190 landing while the owner was mid-way through pasting
 * a fresh token, asking out loud which of the two fields it belonged in; the message he had in
 * front of him named only Settings, which for a group token is the field nothing reads.
 */
describe('naming the screen that holds the failing token', () => {
  const SETTINGS = 'הגדרות ← אינטגרציות';
  const GROUPS = 'מסך קבוצות';
  const expired = graph(190, 'Session has expired');

  it('sends the owner to the GROUP when the group token is the one that failed', () => {
    const msg = facebookError(expired, 'facebook', null, 'channel').message;
    expect(msg).toContain(GROUPS);
    expect(msg).not.toContain(SETTINGS);
  });

  it('sends the owner to SETTINGS when the account token is the one that failed', () => {
    const msg = facebookError(expired, 'facebook', null, 'account').message;
    expect(msg).toContain(SETTINGS);
    expect(msg).not.toContain(GROUPS);
  });

  it('says the group token WINS, so re-pasting in Settings is not the fix', () => {
    // Without this the owner updates Settings, retries, fails identically, and concludes the
    // new token is bad — the loop that made #73 cost an hour.
    expect(facebookError(expired, 'facebook', null, 'channel').message).toContain('גובר');
  });

  it('names BOTH screens in precedence order when the caller did not say', () => {
    // A guess here is what produces a wrong address. Callers that cannot know (Instagram
    // resolves its token deeper in the stack) get the honest answer instead.
    const msg = facebookError(expired).message;
    expect(msg).toContain(SETTINGS);
    expect(msg).toContain('טוקן משלה');
  });

  it('addresses a missing PERMISSION the same way — #200 and #10 are one owner action', () => {
    // #72 and #73 were the same question a day apart: the token is right, where does it go?
    for (const code of [200, 10]) {
      const msg = facebookError(graph(code, 'permissions essay'), 'facebook', null, 'channel').message;
      expect(msg).toContain('pages_manage_posts');
      expect(msg).toContain(GROUPS);
    }
  });

  it('leaves the Instagram #10 message alone — it is not about a Page token at all', () => {
    const msg = facebookError(graph(10, 'no permission'), 'instagram', null, 'account').message;
    expect(msg).toContain('instagram_content_publish');
    expect(msg).not.toContain(SETTINGS);
  });

  it('still says nothing about screens on a transient blip', () => {
    const msg = facebookError(graph(2, 'unexpected error'), 'facebook', null, 'channel').message;
    expect(msg).not.toContain(GROUPS);
    expect(msg).not.toContain(SETTINGS);
  });

  it('carries through to the one-line report', () => {
    expect(facebookErrorText(expired, 'facebook', null, 'channel')).toContain(GROUPS);
  });
});

describe('isTransientFacebookError', () => {
  const graphErr = (code: number, message: string) =>
    ({ response: { data: { error: { code, message } } } });

  it('marks #1 and #2 retryable — Graph rejected explicitly and asked for a retry', () => {
    expect(isTransientFacebookError(graphErr(1, "Please reduce the amount of data you're asking for, then retry your request"))).toBe(true);
    expect(isTransientFacebookError(graphErr(2, 'Service temporarily unavailable'))).toBe(true);
  });

  it('does NOT mark a timeout retryable — Facebook may have already published', () => {
    expect(isTransientFacebookError(Object.assign(new Error('timeout of 20000ms exceeded'), { code: 'ECONNABORTED' }))).toBe(false);
  });

  it('does NOT retry real verdicts: bad token, bad params, rate limits', () => {
    expect(isTransientFacebookError(graphErr(190, 'Session has expired'))).toBe(false);
    expect(isTransientFacebookError(graphErr(100, 'Invalid parameter'))).toBe(false);
    expect(isTransientFacebookError(graphErr(4, 'Application request limit reached'))).toBe(false);
    expect(isTransientFacebookError({})).toBe(false);
  });
});

describe('connection-level Meta failures', () => {
  const aggregate = (codes: string[]) =>
    new AggregateError(codes.map((code) => Object.assign(new Error(`connect ${code}`), { code })), '');

  it('names the network codes instead of a bare "שגיאה לא ידועה"', () => {
    // The exact partial-publish symptom: an AggregateError has an EMPTY message, so the
    // owner saw "Instagram: שגיאה לא ידועה" with nothing to act on.
    const info = facebookError(aggregate(['ECONNRESET']), 'instagram');
    expect(info.message).toContain('ECONNRESET');
    expect(info.message).toContain('הרשת');
    expect(info.needsUserAction).toBe(false);
  });

  it('keeps real code-thrown messages untouched (they are not network noise)', () => {
    expect(facebookError(new Error('Missing Instagram credentials')).message).toBe('Missing Instagram credentials');
  });

  describe('isMetaConnectionError', () => {
    it('recognises plain and aggregate connection failures', () => {
      expect(isMetaConnectionError(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }))).toBe(true);
      expect(isMetaConnectionError(aggregate(['ECONNREFUSED', 'ENETUNREACH']))).toBe(true);
    });

    it('treats an INNER (connect-phase) ETIMEDOUT as retry-safe', () => {
      // Issue #50: Happy Eyeballs aggregate with ETIMEDOUT — the socket never opened,
      // nothing reached Meta, yet the container-create retry never fired.
      expect(isMetaConnectionError(aggregate(['ETIMEDOUT']))).toBe(true);
      expect(isMetaConnectionError(aggregate(['ETIMEDOUT', 'ECONNREFUSED']))).toBe(true);
    });

    it('accepts an aggregate that carries ETIMEDOUT on ITSELF, with illegible inners', () => {
      // Watchdog #69's shape, on the Meta side of the same rule: Node stamps the code on the
      // aggregate and the inner attempts arrive with nothing readable. The aggregate is the
      // proof of the connect phase, so this is a socket that never opened — not the
      // ambiguous response-phase timeout a bare ETIMEDOUT would otherwise read as.
      const outer = Object.assign(new AggregateError([new Error(''), new Error('')], ''), { code: 'ETIMEDOUT' });
      expect(isMetaConnectionError(outer)).toBe(true);
      expect(isMetaTimeoutError(outer)).toBe(false);
    });

    it('sees the aggregate axios hid in `cause`', () => {
      // Watchdog #71's shape on the Meta side: axios rebuilds the failure, copies the empty
      // message and ETIMEDOUT across, and leaves the aggregate — the only thing proving the
      // socket never opened — in `cause`. From the top it is indistinguishable from the
      // ambiguous timeout that must not be resent.
      const inner = new AggregateError(
        [Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' })], '',
      );
      const axiosLike = Object.assign(new Error(''), { code: 'ETIMEDOUT', cause: inner });
      expect(isMetaConnectionError(axiosLike)).toBe(true);
      expect(isMetaTimeoutError(axiosLike)).toBe(false);
    });

    it('still refuses a wrapped timeout with no aggregate under it', () => {
      const wrapped = Object.assign(new Error('timeout of 15000ms exceeded'), {
        code: 'ETIMEDOUT',
        cause: Object.assign(new Error('socket timeout'), { code: 'ETIMEDOUT' }),
      });
      expect(isMetaConnectionError(wrapped)).toBe(false);
      expect(isMetaTimeoutError(wrapped)).toBe(true);   // ambiguous, and named as such
    });

    it('rejects timeouts, HTTP responses and plain errors', () => {
      // A TOP-LEVEL timeout is response-phase — the request may have arrived.
      expect(isMetaConnectionError(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))).toBe(false);
      expect(isMetaConnectionError(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }))).toBe(false);
      expect(isMetaConnectionError({ code: 'ECONNRESET', response: { status: 400 } })).toBe(false);
      expect(isMetaConnectionError(new Error('anything'))).toBe(false);
      expect(isMetaConnectionError({})).toBe(false);
    });
  });
});

/**
 * Watchdog #67: one Instagram post filed as "published partially" with
 * "אינסטגרם לא השיבה בזמן. ייתכן שהפרסום כן בוצע — בדוק בחשבון".
 *
 * It timed out CREATING the media container — a step that publishes nothing — so that
 * sentence sent the owner looking for a post that could not exist. The distinction this
 * predicate draws is which resends are safe, and it is not the same question
 * isMetaConnectionError answers.
 */
describe('isMetaTimeoutError', () => {
  const timeout = (code?: string, message = 'timeout of 15000ms exceeded') =>
    Object.assign(new Error(message), code ? { code } : {});

  it('recognises an axios timeout in both of its shapes', () => {
    expect(isMetaTimeoutError(timeout('ECONNABORTED'))).toBe(true);
    expect(isMetaTimeoutError(timeout('ETIMEDOUT'))).toBe(true);
    // Older axios builds carry the reason only in the message.
    expect(isMetaTimeoutError(timeout(undefined))).toBe(true);
  });

  it('says no when Meta actually answered', () => {
    // A Graph error is a verdict, not a timeout — resending it repeats the same failure.
    expect(isMetaTimeoutError({ response: { data: { error: { code: 100 } } } })).toBe(false);
  });

  it('leaves a wire failure to isMetaConnectionError', () => {
    // Both are resendable, but they are different findings and the send path branches on
    // the connection case first. Reporting a socket error as a timeout would hide it.
    const reset = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    expect(isMetaConnectionError(reset)).toBe(true);
    expect(isMetaTimeoutError(reset)).toBe(false);
    // Happy-Eyeballs connect timeouts are the connection case too, by the same rule.
    const connect = Object.assign(new AggregateError([Object.assign(new Error(''), { code: 'ETIMEDOUT' })], ''), {});
    expect(isMetaConnectionError(connect)).toBe(true);
    expect(isMetaTimeoutError(connect)).toBe(false);
  });

  it('says no to an ordinary error', () => {
    expect(isMetaTimeoutError(new Error('Instagram container creation failed'))).toBe(false);
    expect(isMetaTimeoutError(null)).toBe(false);
    expect(isMetaTimeoutError(undefined)).toBe(false);
  });
});

/**
 * Watchdog #68: an Instagram post filed as "published partially" with the bare English
 * sentence "An unexpected error has occurred. Please retry your request later."
 *
 * That is Graph's transient #2 — but it reached the owner unclassified, because the
 * media_publish call runs with `validateStatus: () => true`: the error arrives as a BODY,
 * and re-throwing `new Error(error.message)` threw the code away. With no code, no mapping
 * in this file could fire, so there was neither a retry nor a Hebrew explanation.
 */
describe('metaGraphError — a Graph error read out of a body', () => {
  const payload = { code: 2, message: 'An unexpected error has occurred. Please retry your request later.' };

  it('stays classifiable: the same verdict as if axios had thrown it', () => {
    const fromBody = facebookError(metaGraphError(payload), 'instagram');
    const fromThrow = facebookError({ response: { data: { error: payload } } }, 'instagram');
    expect(fromBody).toEqual(fromThrow);
    expect(fromBody.code).toBe(2);
    expect(fromBody.message).toContain('זמנית');       // Hebrew, not Graph's English
    expect(fromBody.needsUserAction).toBe(false);      // nothing on the owner's side is wrong
  });

  it('is still recognised as retryable — which is the whole point', () => {
    expect(isTransientFacebookError(metaGraphError(payload))).toBe(true);
    // The publish loop tests the raw payload it just read, before wrapping it.
    expect(isTransientFacebookError({ error: payload })).toBe(true);
    expect(isTransientFacebookError({ error: null })).toBe(false);
  });

  it('keeps the code in the one-line report', () => {
    expect(facebookErrorText(metaGraphError(payload), 'instagram')).toMatch(/^\(#2\)/);
  });

  it('does not invent a verdict for a payload that carries no code', () => {
    const codeless = metaGraphError({ message: 'no code here' });
    expect(facebookError(codeless).message).toBe('no code here');
    expect(isTransientFacebookError(codeless)).toBe(false);
  });
});
