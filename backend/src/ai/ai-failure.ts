/**
 * Why a provider produced no copy, in a few words the owner can act on.
 *
 * A campaign run that loses every draft used to say only «ספקי ה-AI לא החזירו טקסט»; the
 * reason (a refused key, an empty credit balance, a retired model) was in the server log,
 * which the owner cannot read. The run note now carries this line instead.
 */
export function describeAiFailure(err: any): string {
  const status = err?.response?.status;
  const data = err?.response?.data;
  const raw = String(
    data?.error?.message || (typeof data?.error === 'string' ? data.error : '') || err?.message || 'unknown error',
  );
  const msg = raw.replace(/\s+/g, ' ').trim();
  if (/credit balance is too low|insufficient_quota|exceeded your current quota|billing/i.test(msg)) {
    return 'נגמר הקרדיט בחשבון';
  }
  if (status === 401 || status === 403 || /invalid x-api-key|invalid api key|api key not valid|permission/i.test(msg)) {
    return 'המפתח נדחה';
  }
  if (status === 404 || /model.*(not found|does not exist|deprecated)/i.test(msg)) return `המודל לא נמצא (${msg.slice(0, 60)})`;
  if (status === 429 || status === 529 || /overloaded|rate limit/i.test(msg)) return 'עומס אצל הספק';
  if (/timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND|socket hang up/i.test(msg)) return 'אין תשובה מהספק (timeout)';
  return `${status ? `${status} ` : ''}${msg.slice(0, 80)}`;
}

/** The account's key itself was refused — worth one more try on the platform's key. */
export function isRefusedKey(err: any): boolean {
  const status = err?.response?.status;
  const msg = String(err?.response?.data?.error?.message || err?.message || '');
  return status === 401 || status === 403 || /invalid x-api-key/i.test(msg);
}

/** A provider answered, but with no text — name what it said instead. */
export function describeEmptyAnswer(stopReason?: string | null): string {
  const r = String(stopReason || '').toLowerCase();
  if (r === 'refusal' || r === 'safety' || r === 'content_filter') return 'המודל סירב לכתוב על המוצר';
  return r ? `תשובה ריקה (${r})` : 'תשובה ריקה';
}
