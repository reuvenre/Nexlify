import * as crypto from 'crypto';

/**
 * Minimal TOTP (RFC 6238) — SHA-1, 6 digits, 30s step. Compatible with Google
 * Authenticator, Authy, 1Password, Microsoft Authenticator, etc. Pure crypto, no
 * external OTP dependency.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Random base32 secret (default 20 bytes → 32 chars). */
export function generateTotpSecret(bytes = 20): string {
  const buf = crypto.randomBytes(bytes);
  let bits = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  return out;
}

function base32Decode(secret: string): Buffer {
  const clean = secret.replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
  let bits = '';
  for (const c of clean) {
    const idx = BASE32_ALPHABET.indexOf(c);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

/** 6-digit code for a given secret at a given time step. */
function codeForCounter(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  // 64-bit big-endian counter.
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (binary % 1_000_000).toString().padStart(6, '0');
}

/**
 * Verify a user-supplied 6-digit code, allowing ±1 time step (±30s) for clock skew.
 * Constant-time-ish compare per candidate.
 */
export function verifyTotp(secret: string, token: string, nowMs = 0): boolean {
  const code = (token || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return false;
  // nowMs is passed in by the caller (Date.now() is unavailable in some sandboxes).
  const now = nowMs || Date.now();
  const counter = Math.floor(now / 1000 / 30);
  for (let w = -1; w <= 1; w++) {
    if (safeEqual(codeForCounter(secret, counter + w), code)) return true;
  }
  return false;
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** otpauth:// URI for QR provisioning. */
export function totpUri(secret: string, account: string, issuer = 'Nexlify'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
