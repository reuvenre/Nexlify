/**
 * What to do after an Instagram publish call times out.
 *
 * A timeout on `media_publish` is the one genuinely ambiguous failure in the whole send
 * path: the request may have reached Instagram and only the reply was lost, so retrying
 * risks a duplicate post — which is why it was never retried, and why it kept surfacing as
 * a "published partially" alert that no automation could clear.
 *
 * But the ambiguity is only ours. Instagram knows: the media CONTAINER carries a
 * status_code, and it turns PUBLISHED the moment the media goes live. So instead of
 * guessing, ask the container — and the answer is authoritative in both directions.
 */

export type PublishVerdict = 'published' | 'retry' | 'unknown';

/**
 * @param statusCode the container's `status_code`, or undefined when the check itself failed
 */
export function publishTimeoutVerdict(statusCode: string | null | undefined): PublishVerdict {
  const code = String(statusCode || '').trim().toUpperCase();
  // It went live. The timed-out call DID land — treat the send as the success it was.
  if (code === 'PUBLISHED') return 'published';
  // Processed and waiting: nothing was published, so publishing again cannot duplicate.
  if (code === 'FINISHED' || code === 'IN_PROGRESS') return 'retry';
  // ERROR, EXPIRED, or no answer at all — say nothing and let the caller fail loudly
  // rather than invent an outcome.
  return 'unknown';
}

export type NotReadyVerdict = 'published' | 'wait' | 'rejected' | 'expired';

/**
 * What to do when `media_publish` answers #9007 "Media ID is not available".
 *
 * It means the container is not publishable YET — usually still processing an image Meta
 * fetched slowly (ours goes through /posts/ig-image, which pulls from the supplier CDN).
 * Retrying blind on a fixed count gave up after ~45 s and filed a healthy post as
 * "published partially" (#96). The container knows which case it is:
 *  - PUBLISHED: an earlier attempt landed after all — the post is live.
 *  - FINISHED / IN_PROGRESS / no answer: keep waiting, within the caller's bound.
 *  - ERROR: Instagram rejected the image — waiting cannot fix it.
 *  - EXPIRED: the container is gone — only a fresh send can publish.
 */
export function notReadyVerdict(statusCode: string | null | undefined): NotReadyVerdict {
  const code = String(statusCode || '').trim().toUpperCase();
  if (code === 'PUBLISHED') return 'published';
  if (code === 'ERROR') return 'rejected';
  if (code === 'EXPIRED') return 'expired';
  return 'wait';
}
