/**
 * `FRONTEND_URL` doubles as the CORS allow-list, so it may carry a COMMA-SEPARATED list
 * of domains (e.g. "https://nexlify.win-solutions.co.il,https://ali-bot-pro.vercel.app").
 * Redirects and emailed links must use exactly ONE origin — feeding them the raw value
 * would produce "https://a,https://b/google/success". The first entry is canonical.
 */
export function primaryUrl(raw: string | undefined, fallback = 'http://localhost:3000'): string {
  const first = (raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)[0];
  return (first || fallback).replace(/\/+$/, '');
}
