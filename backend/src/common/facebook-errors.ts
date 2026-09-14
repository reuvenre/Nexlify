/**
 * Turn a Graph API failure into something the account owner can act on.
 *
 * Graph errors arrive as long English paragraphs describing every branch of a permission
 * model ("If posting to a group… If posting to a page…"), which lands in a Hebrew UI as a
 * wall of text that doesn't say which case applies or what to change. The owner needs the
 * one sentence that tells them where to click; the raw text is kept only when the code is
 * unknown, so nothing is silently swallowed.
 */

export interface FacebookErrorInfo {
  code: number | null;
  /** Actionable Hebrew message for the owner. */
  message: string;
  /** True when only the user can fix it — a retry will fail identically. */
  needsUserAction: boolean;
}

export type MetaPlatform = 'facebook' | 'instagram';

/**
 * WHICH of the two stored tokens the failed call used.
 *
 * A group carrying its own Page token OVERRIDES the account-level one — the send path reads
 * the channel's token first and never looks at Settings → Integrations when it finds one. So
 * a #190 on a group token that told the owner to go re-paste in Settings sent them to a
 * screen whose value that send will not even read, and the next attempt failed identically.
 * The send site has always known which token it picked; it simply was not saying.
 */
export type TokenSource = 'channel' | 'account';

/** Codes that mean the request died at the wire — DNS/socket — before reaching Graph. */
const CONNECTION_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH',
]);

/**
 * Inside an AggregateError the codes come from Node's Happy Eyeballs CONNECT loop, so an
 * INNER ETIMEDOUT is a connect-phase timeout — the socket never opened and nothing reached
 * Meta (same distinction telegram-retry.ts documents). A TOP-LEVEL ETIMEDOUT stays
 * non-retryable: on an established connection the request may have arrived and only the
 * reply was lost. Issue #50 was exactly the inner case going un-retried.
 */
const AGGREGATE_CONNECT_CODES = new Set([...CONNECTION_CODES, 'ETIMEDOUT']);

/**
 * The failure and everything it wraps.
 *
 * axios does not re-throw what it caught: it builds an AxiosError, copies `message` and
 * `code` across, and hangs the original off `cause`. A Happy Eyeballs AggregateError
 * therefore arrives with an EMPTY message, `code: 'ETIMEDOUT'` and NO `errors` array — the
 * proof that the socket never opened is a level down. Bounded, and cycle-safe.
 */
function causeChain(err: any, max = 4): any[] {
  const chain: any[] = [];
  let cur = err;
  while (cur && chain.length < max && !chain.includes(cur)) {
    chain.push(cur);
    cur = cur.cause;
  }
  return chain;
}

/** The AggregateError in the failure or anything it wraps, if there is one. */
function aggregateIn(err: any): any | undefined {
  return causeChain(err).find((e) => Array.isArray(e?.errors));
}

/** Every error code hiding in the failure — its own, its causes', plus an AggregateError's
 *  inner ones (Node's Happy Eyeballs connect throws those with an EMPTY top-level message). */
function errorCodes(err: any): string[] {
  const chain = causeChain(err);
  const inner = aggregateIn(err)?.errors ?? [];
  return Array.from(new Set(
    [...chain.map((e: any) => e?.code), ...inner.map((e: any) => e?.code)]
      .filter((c): c is string => typeof c === 'string' && !!c),
  ));
}

/**
 * True when a Graph request provably never REACHED Meta — a connection-level failure with
 * no HTTP response. Safe to send again: nothing was published. (A timeout is NOT this —
 * the request may have arrived and only the reply was lost.)
 */
export function isMetaConnectionError(err: any): boolean {
  if (err?.response) return false;
  const aggregate = aggregateIn(err);
  const innerCodes = (aggregate?.errors ?? [])
    .map((e: any) => e?.code)
    .filter((c: any): c is string => typeof c === 'string' && !!c);
  // Aggregate (connect-phase) failures may include ETIMEDOUT — see AGGREGATE_CONNECT_CODES.
  if (innerCodes.length) return innerCodes.every((c: string) => AGGREGATE_CONNECT_CODES.has(c));
  // Being an AggregateError is itself the connect-phase proof, so an ETIMEDOUT alongside one
  // counts even when the inner failures carry no legible code (watchdog #69 — and #71, where
  // axios had rebuilt the failure and left the aggregate in `cause`). Without this it falls
  // through to the check below, where a bare ETIMEDOUT reads as the ambiguous response-phase
  // timeout it is not.
  if (aggregate && errorCodes(err).some((c) => AGGREGATE_CONNECT_CODES.has(c))) return true;
  const codes = errorCodes(err);
  return codes.length > 0 && codes.every((c) => CONNECTION_CODES.has(c));
}

/**
 * True when Meta never answered in time — the request may or may not have arrived.
 *
 * Deliberately NOT merged into isMetaConnectionError: that one means the request provably
 * never reached Meta, so it is safe to resend anywhere. A timeout is only safe to resend at
 * a step that publishes NOTHING, and only the call site knows which step it is at. Creating
 * an Instagram media container is such a step — it stages an upload, and the media goes
 * live only on media_publish — while a timeout on media_publish itself is the genuinely
 * ambiguous case that has to ask the container what happened.
 */
export function isMetaTimeoutError(err: any): boolean {
  if (err?.response) return false;               // Meta answered; whatever this is, it is not a timeout
  if (isMetaConnectionError(err)) return false;  // died at the wire — the other, broader case
  if (errorCodes(err).some((c) => c === 'ETIMEDOUT' || c === 'ECONNABORTED')) return true;
  return /timeout|timed out/i.test(String(err?.message || ''));
}

/** The Graph error payload hiding in a failure, whichever shape it arrived in: thrown by
 *  axios (`response.data.error`) or read out of a body by a `validateStatus: () => true`
 *  call and re-thrown via {@link metaGraphError} (`error`). One lookup, so every classifier
 *  in this file sees the same thing. */
function graphPayload(err: any): any {
  return err?.response?.data?.error ?? err?.error;
}

/**
 * Wrap a Graph error PAYLOAD in a real Error that this file can still classify.
 *
 * A call made with `validateStatus: () => true` never throws — the error arrives as a body,
 * and re-throwing it as `new Error(error.message)` drops the CODE, and with it every mapping
 * below. That is how an Instagram publish that failed on Graph's own transient #2 reached the
 * owner as a bare English sentence in a Hebrew UI, with no retry and nothing to act on.
 */
export function metaGraphError(payload: any): Error & { error?: any } {
  const err = new Error(payload?.message || 'שגיאה לא ידועה') as Error & { error?: any };
  err.error = payload;
  return err;
}

export function facebookError(
  err: any, platform: MetaPlatform = 'facebook', pageId?: string | null, tokenSource?: TokenSource,
): FacebookErrorInfo {
  const e = graphPayload(err);
  const code: number | null = typeof e?.code === 'number' ? e.code : null;
  const subcode: number | null = typeof e?.error_subcode === 'number' ? e.error_subcode : null;
  const raw = e?.message || err?.response?.data?.message || err?.message || 'שגיאה לא ידועה';

  // WHICH page. Every message below that ends in "go re-issue a token" is useless without
  // it on an account that publishes to several pages: the owner is told exactly what to do
  // and not where to do it, and a page id is the one identifier both this system and the
  // Meta UI share. Only attached where the owner has to act — a transient blip needs no
  // address. The send path knows it; it simply was not passing it.
  const at = String(pageId || '').trim() ? ` (דף ${String(pageId).trim()})` : '';
  const act = (message: string): FacebookErrorInfo => ({ code, message: `${message}${at}`, needsUserAction: true });

  // WHERE to put the new token — see {@link TokenSource}. When the caller doesn't say, name
  // both screens in precedence order rather than guessing one: a wrong address is what makes
  // the owner re-paste into a field nothing reads.
  const tokenScreen = (): string => {
    if (tokenSource === 'channel') return 'במסך קבוצות, אצל הקבוצה שנכשלה — הטוקן שלה גובר על זה שבהגדרות';
    if (tokenSource === 'account') return 'בהגדרות ← אינטגרציות';
    return 'בהגדרות ← אינטגרציות, ואם לקבוצה שנכשלה יש טוקן משלה — גם שם, כי הוא גובר';
  };

  /** #10 and #200 are the same owner action with two Graph codes — one sentence, one place. */
  const noPublishPermission = (): string =>
    'אין הרשאת פרסום לדף. נדרש Page Access Token (לא טוקן משתמש) של אדמין הדף, '
    + `עם ההרשאות pages_manage_posts ו-pages_read_engagement, ויש להדביק אותו ${tokenScreen()}.`;

  // A timeout is not a Graph error and carries no code, but it is the most common failure
  // when a post attaches a link: Graph fetches that URL to build the preview before it
  // answers, so the round trip can outlast a short client timeout.
  if (!code && /timeout|ETIMEDOUT|ECONNABORTED/i.test(String(raw))) {
    // Two corrections live in this sentence. It named FACEBOOK on an Instagram failure,
    // and it promised an automatic retry that does not exist: a partially-published post
    // is `sent`, so no scheduler picks it up, and the network auto-retry deliberately
    // excludes timeouts (the request may have landed — see network-partial.ts). Saying
    // "it will be retried" sent the owner to wait for something that never came.
    const name = platform === 'instagram' ? 'אינסטגרם' : 'פייסבוק';
    return {
      code: null,
      message: `${name} לא השיבה בזמן. ייתכן שהפרסום כן בוצע — בדוק בחשבון, ואם הפוסט אינו שם לחץ "נסה שוב".`,
      needsUserAction: false,
    };
  }

  // No Graph response and no usable message — the wire failed before Meta ever answered
  // (an AggregateError's message is EMPTY, so `raw` fell through to the generic fallback,
  // and the owner used to see a bare "שגיאה לא ידועה" with nothing to act on). Name the
  // network codes: they ARE the diagnosis, and there is nothing to fix in the settings.
  if (!code && !err?.response && raw === 'שגיאה לא ידועה') {
    const codes = errorCodes(err);
    return {
      code: null,
      message: `החיבור לשרתי מטא נכשל ברמת הרשת (${codes.join(', ') || 'שגיאת חיבור'}) — תקלה זמנית, נסה שוב.`,
      needsUserAction: false,
    };
  }

  switch (code) {
    case 1:
    case 2:
      // Graph's "unknown error" / "service temporarily unavailable" family — including the
      // "(#1) Please reduce the amount of data you're asking for, then retry your request"
      // flavour that photo publishes hit under load. Facebook itself says to retry; nothing
      // was published, nothing on the user's side is wrong.
      return {
        code,
        message: `תקלה זמנית בשרתי פייסבוק — בוצע ניסיון חוזר אוטומטי. (פייסבוק אמרה: ${raw})`,
        needsUserAction: false,
      };
    case 10:
      // #10 means two different things depending on the surface, and the Facebook wording
      // sent Instagram users to re-issue a Page token that was never the problem.
      return act(platform === 'instagram'
        ? 'חסרה ההרשאה instagram_content_publish. במסך האישור של פייסבוק יש לאשר פרסום תוכן באינסטגרם — '
          + 'ההרשאה instagram_manage_events אינה מספיקה לפרסום.'
        : noPublishPermission());
    case 200:
      return act(noPublishPermission());
    case 190:
      // #190 covers four different owner actions, and the generic "renew the token" wording
      // sent the account owner to re-paste a token from a session Facebook had already killed
      // — which fails identically, every time. The subcode is the only thing that says which
      // action actually helps, so it decides the message.
      if (subcode === 460) {
        return act(
          'הסשן של פייסבוק בוטל בעקבות שינוי סיסמה או איפוס אבטחה. '
          + 'העתקה מחדש של אותו טוקן לא תעזור — כל הטוקנים מהסשן הקודם מתו. '
          + 'יש להתחבר מחדש לפייסבוק, להפיק Page Access Token חדש לכל דף בנפרד, ולעדכן כל קבוצה.',
        );
      }
      if (subcode === 458) {
        return act(
          'האפליקציה הוסרה מחשבון הפייסבוק. יש לאשר אותה מחדש במסך האישור של פייסבוק '
          + '(ולסמן שם את הדפים הרלוונטיים) ואז להפיק Page Access Token חדש.',
        );
      }
      if (subcode === 492) {
        return act(
          'המשתמש שהפיק את הטוקן אינו אדמין של הדף הזה. יש להפיק Page Access Token '
          + 'ממשתמש עם הרשאת אדמין על הדף.',
        );
      }
      return act(`טוקן הפייסבוק פג תוקף או בוטל. יש לחדש אותו ${tokenScreen()}.`);
    case 100:
    case 803: {
      // #100 is Graph's GENERIC "invalid parameter" — a wrong Page ID is only its most
      // common cause. It also fires on a bad `link`, an unknown field, or a malformed
      // argument, and blaming the Page ID unconditionally sent the owner to re-check an id
      // that was correct while the real culprit sat untouched. Graph names the offending
      // parameter in its own message, so let that decide, and never drop what it said.
      if (/\blink\b/i.test(raw)) {
        return act(
          'פייסבוק דחתה את הקישור שבפוסט. הקישור חייב להיות כתובת מלאה וציבורית '
          + `שפייסבוק יכולה לפתוח. (פייסבוק אמרה: ${raw})`,
        );
      }
      if (/nonexisting|does not exist|cannot be loaded|Unsupported (get|post) request/i.test(raw)) {
        return act(
          'מזהה הדף (Page ID) אינו תקין או שהטוקן לא מכסה אותו. '
          + 'יש להשתמש במזהה שחוזר מ-GET /me/accounts, לא במספר מכתובת profile.php.',
        );
      }
      // Unknown flavour of #100: say what Facebook said rather than guess a cause.
      return act(
        'פייסבוק דחתה את הבקשה כלא תקינה. '
        + `הסיבה הנפוצה היא Page ID שגוי, אך פייסבוק אמרה: ${raw}`,
      );
    }
    case 368:
      return act('הדף חסום זמנית לפרסום על ידי פייסבוק. יש להמתין לפני ניסיון נוסף.');
    case 4:
    case 17:
    case 613:
      // Transient by nature — the scheduler's next run is the fix, so don't send the owner
      // chasing a settings change that isn't the problem.
      return { code, message: 'חריגה ממכסת הבקשות של פייסבוק — הפרסום יינסה שוב בריצה הבאה.', needsUserAction: false };
    default:
      return { code, message: raw, needsUserAction: false };
  }
}

/** Marks a failure that provably never reached Meta — see telegram-retry.ts NET_SAFE_TAG. */
export const NET_SAFE_TAG = '[net]';

/** One-line form for a post's error_message / the errors list shown in the UI. */
export function facebookErrorText(
  err: any, platform: MetaPlatform = 'facebook', pageId?: string | null, tokenSource?: TokenSource,
): string {
  const { code, message } = facebookError(err, platform, pageId, tokenSource);
  const text = code ? `(#${code}) ${message}` : message;
  // The tag is the auto-retry's only input: a connect-phase failure published nothing, so
  // re-sending it cannot duplicate. Everything else is left for the owner to read.
  return isMetaConnectionError(err) ? `${text} ${NET_SAFE_TAG}` : text;
}

/**
 * May this Graph failure be sent again safely?
 *
 * ONLY an explicit Graph error response with a transient code (#1 unknown / #2 service
 * unavailable) qualifies: Facebook answered, said "try again", and published nothing — a
 * retry cannot duplicate. A timeout is deliberately NOT retryable here even though it is
 * transient too: Facebook may have published before the reply was lost, and a retry would
 * put the post on the page twice (see the long-timeout comment at the send site).
 */
export function isTransientFacebookError(err: any): boolean {
  const e = graphPayload(err);
  return typeof e?.code === 'number' && (e.code === 1 || e.code === 2);
}
