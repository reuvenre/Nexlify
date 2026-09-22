/**
 * The designed Pinterest pin frame — layout and SVG, as pure functions.
 *
 * Why a frame at all: Pinterest's feed is vertical columns, and the standard pin is 2:3
 * (1000×1500). Our product images are square-ish AliExpress shots — in the feed they take
 * half the screen height of everyone else's pins and look like the smallest thing on the
 * page. This composes each pin as a full 2:3 canvas: the product photo on a clean field,
 * a band with the pin's own English title (the text is what makes a scroller stop, and it
 * doubles as search signal), and a price tag — the one fact that makes a product pin
 * clickable.
 *
 * Everything that decides how the frame LOOKS lives here so it can be unit-tested; the
 * endpoint (instagram-image.controller.ts) only fetches, composites and streams.
 */

import { applyWordPolicy } from './word-policy';

export const PIN_W = 1000;
export const PIN_H = 1500;
/** The product image lives above the band, letterboxed onto this area. */
export const PIN_IMAGE_H = 1180;
const BAND_H = PIN_H - PIN_IMAGE_H;

/** XML-escape a user-supplied string headed into SVG text. */
export function escapeXml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Word-wrap the title to at most `maxLines` lines of ~`perLine` characters, ellipsizing
 * the tail. Product titles run long; two clean lines beat four cramped ones.
 */
export function wrapPinTitle(title: string, perLine = 30, maxLines = 2): string[] {
  const words = String(title || '').trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) { cur = w; continue; }
    if ((cur + ' ' + w).length <= perLine) { cur += ' ' + w; continue; }
    lines.push(cur);
    cur = w;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length > maxLines) lines.length = maxLines;
  // Anything left over → ellipsis on the last line.
  const consumed = lines.join(' ').split(/\s+/).length;
  if (consumed < words.length && lines.length) {
    let last = lines[lines.length - 1];
    if (last.length > perLine - 1) last = last.slice(0, perLine - 1).trimEnd();
    lines[lines.length - 1] = `${last}…`;
  }
  return lines;
}

/**
 * The SVG overlay composited over the letterboxed product image: title band + price tag.
 * Fonts fall back down a safe stack; a host with no fonts at all degrades to band-and-tag
 * without text rather than failing the pin.
 */
export function buildPinOverlaySvg(title: string, price: string): string {
  // The title here is display copy burned into an image, which puts it beyond every text
  // filter downstream — once the pin is composited nothing can revise it. The vocabulary
  // policy is applied at this one function because both renderers (the live controller and
  // the batch composer) pass through it, and the title usually comes straight from a
  // supplier listing that no copy model ever touched.
  const lines = wrapPinTitle(applyWordPolicy(title));
  const two = lines.length > 1;
  // Vertically center 1 or 2 lines inside the band.
  const firstY = PIN_IMAGE_H + (two ? BAND_H / 2 - 14 : BAND_H / 2 + 22);
  const text = lines
    .map((l, i) => `<tspan x="${PIN_W / 2}" y="${firstY + i * 64}">${escapeXml(l)}</tspan>`)
    .join('');
  // The price tag sits astride the band's top edge — the classic "sticker" placement.
  const tag = price
    ? `<g>
        <rect x="${PIN_W - 300}" y="${PIN_IMAGE_H - 44}" rx="44" ry="44" width="252" height="88" fill="#E60023"/>
        <text x="${PIN_W - 174}" y="${PIN_IMAGE_H + 16}" text-anchor="middle" font-family="DejaVu Sans, Arial, Helvetica, sans-serif" font-size="42" font-weight="700" fill="#FFFFFF">${escapeXml(price)}</text>
      </g>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PIN_W}" height="${PIN_H}" viewBox="0 0 ${PIN_W} ${PIN_H}">
    <rect x="0" y="${PIN_IMAGE_H}" width="${PIN_W}" height="${BAND_H}" fill="#1F2430"/>
    <text text-anchor="middle" font-family="DejaVu Sans, Arial, Helvetica, sans-serif" font-size="50" font-weight="700" fill="#FFFFFF">${text}</text>
    ${tag}
  </svg>`;
}

/**
 * The public URL that serves a post's designed pin frame. Query params are length-capped:
 * the title is display copy, not a payload, and an absurdly long URL gets pins rejected.
 */
export function pinImageUrl(base: string, src: string, title: string, price: string): string {
  const b = String(base || '').replace(/\/$/, '');
  const params = new URLSearchParams({ src });
  if (title) params.set('title', title.slice(0, 120));
  if (price) params.set('price', price.slice(0, 16));
  return `${b}/posts/pin-image?${params.toString()}`;
}
