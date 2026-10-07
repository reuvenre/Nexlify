import axios from 'axios';

/**
 * The 17TRACK tracking API (v2.4), the three calls the parcel tracking uses.
 *
 * The key is the owner's own, set as SEVENTEEN_TRACK_API_KEY in Render. Without it the
 * bot still sends the free tracking page; only the follow-up updates need the API.
 * Limits from the docs: 3 requests/second, 40 numbers per request; a registration counts
 * against the account's quota, a lookup of a registered number does not.
 */
const BASE = 'https://api.17track.net/track/v2.4';

export function seventeenTrackKey(): string | null {
  return (process.env.SEVENTEEN_TRACK_API_KEY || '').trim() || null;
}

export interface RegisterResult { ok: boolean; already?: boolean; quotaOut?: boolean; error?: string }

async function call(path: string, body: unknown): Promise<any> {
  const key = seventeenTrackKey();
  if (!key) throw new Error('no 17TRACK key');
  const res = await axios.post(`${BASE}/${path}`, body, {
    headers: { '17token': key, 'Content-Type': 'application/json' },
    timeout: 20_000,
  });
  return res.data;
}

const QUOTA_OUT = new Set([-18019907, -18019908]);
const ALREADY = -18019901;

/** Register one number for tracking. Already registered counts as success (no new quota). */
export async function registerParcel(number: string): Promise<RegisterResult> {
  try {
    const data = await call('register', [{ number }]);
    if (data?.data?.accepted?.some((a: any) => String(a.number).toUpperCase() === number)) return { ok: true };
    const err = data?.data?.rejected?.[0]?.error;
    if (err?.code === ALREADY) return { ok: true, already: true };
    if (QUOTA_OUT.has(err?.code)) return { ok: false, quotaOut: true, error: err?.message };
    return { ok: false, error: err?.message || `code ${data?.code}` };
  } catch (e: any) {
    return { ok: false, error: e?.response?.status ? `HTTP ${e.response.status}` : e?.message };
  }
}

/** track_info for up to 40 registered numbers, keyed by number. */
export async function parcelInfo(numbers: string[]): Promise<Map<string, any>> {
  const out = new Map<string, any>();
  for (let i = 0; i < numbers.length; i += 40) {
    const data = await call('gettrackinfo', numbers.slice(i, i + 40).map((number) => ({ number })));
    for (const a of data?.data?.accepted || []) {
      if (a?.track_info) out.set(String(a.number).toUpperCase(), a.track_info);
    }
    // 3 requests/second at most.
    if (i + 40 < numbers.length) await new Promise((r) => setTimeout(r, 400));
  }
  return out;
}

/** What is left of the quota — for the owner's /searches line. Null when unknown. */
export async function parcelQuota(): Promise<{ remain: number; total: number } | null> {
  try {
    const data = await call('getquota', []);
    const d = data?.data;
    if (typeof d?.quota_remain !== 'number') return null;
    return { remain: d.quota_remain, total: Number(d.quota_total) || 0 };
  } catch {
    return null;
  }
}
