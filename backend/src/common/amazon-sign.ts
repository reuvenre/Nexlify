import * as crypto from 'crypto';

/**
 * AWS Signature V4 signer for the Amazon Product Advertising API 5.0.
 *
 * PA-API is a normal SigV4 service (service name `ProductAdvertisingAPI`) reached over
 * POST with a JSON body and an `X-Amz-Target` header naming the operation. This returns
 * the full header set to send with the request (Authorization + the signed headers).
 *
 * Ref: https://webservices.amazon.com/paapi5/documentation/sending-request.html
 * Requires an APPROVED Amazon Associates account with PA-API access (the API 403s until
 * the account has made the qualifying sales Amazon requires to unlock it).
 */

const SERVICE = 'ProductAdvertisingAPI';
const ALGORITHM = 'AWS4-HMAC-SHA256';

function sha256Hex(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmac(key: crypto.BinaryLike | Buffer, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

/** yyyymmdd + 'T' + hhmmss + 'Z' in UTC, plus the date-only stamp, for a given epoch ms. */
function amzDates(nowMs: number): { amzDate: string; dateStamp: string } {
  const d = new Date(nowMs);
  const p = (n: number) => String(n).padStart(2, '0');
  const dateStamp = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
  const amzDate = `${dateStamp}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  return { amzDate, dateStamp };
}

export interface AmazonSignInput {
  accessKey: string;
  secretKey: string;
  region: string;   // e.g. 'us-east-1'
  host: string;     // e.g. 'webservices.amazon.com'
  path: string;     // e.g. '/paapi5/searchitems'
  target: string;   // e.g. 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems'
  payload: string;  // JSON body string
  /** Epoch ms — injected so the signature is deterministic/testable. Defaults to Date.now(). */
  nowMs?: number;
}

/** Returns the complete header map (including Authorization) to POST to `https://{host}{path}`. */
export function signAmazonPaapi(input: AmazonSignInput): Record<string, string> {
  const { accessKey, secretKey, region, host, path, target, payload } = input;
  const { amzDate, dateStamp } = amzDates(input.nowMs ?? Date.now());

  const contentEncoding = 'amz-1.0';
  const contentType = 'application/json; charset=utf-8';

  // Canonical request — headers MUST be sorted by lowercased name and match signedHeaders.
  const canonicalHeaders =
    `content-encoding:${contentEncoding}\n` +
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-date:${amzDate}\n` +
    `x-amz-target:${target}\n`;
  const signedHeaders = 'content-encoding;content-type;host;x-amz-date;x-amz-target';

  const canonicalRequest = [
    'POST',
    path,
    '', // no query string
    canonicalHeaders,
    signedHeaders,
    sha256Hex(payload),
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
  const stringToSign = [
    ALGORITHM,
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  // Derive the signing key: HMAC chain seeded with 'AWS4' + secret.
  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const authorization =
    `${ALGORITHM} Credential=${accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    'content-encoding': contentEncoding,
    'content-type': contentType,
    host,
    'x-amz-date': amzDate,
    'x-amz-target': target,
    Authorization: authorization,
  };
}

/** Marketplace → { host, region } for the PA-API endpoint. Defaults to the US (.com). */
export const AMAZON_MARKETPLACES: Record<string, { host: string; region: string }> = {
  'www.amazon.com': { host: 'webservices.amazon.com', region: 'us-east-1' },
  'www.amazon.co.uk': { host: 'webservices.amazon.co.uk', region: 'eu-west-1' },
  'www.amazon.de': { host: 'webservices.amazon.de', region: 'eu-west-1' },
  'www.amazon.fr': { host: 'webservices.amazon.fr', region: 'eu-west-1' },
  'www.amazon.it': { host: 'webservices.amazon.it', region: 'eu-west-1' },
  'www.amazon.es': { host: 'webservices.amazon.es', region: 'eu-west-1' },
  'www.amazon.co.jp': { host: 'webservices.amazon.co.jp', region: 'us-west-2' },
};
