/**
 * Generates every logo asset from the single master file: public/logo-source.svg.
 *
 *   node scripts/gen-logo.js
 *
 * Run this after replacing the master; do not hand-edit the generated files.
 * Requires sharp, which lives in ../backend/node_modules (the frontend has no need for it
 * at runtime — this is a one-off asset tool).
 *
 * The geometry constants below were MEASURED from the rendered master by scanning pixel
 * bands, not eyeballed. If the master artwork changes, re-measure rather than nudging.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('../../backend/node_modules/sharp');

const PUBLIC = path.join(__dirname, '..', 'public');
const MASTER = path.join(PUBLIC, 'logo-source.svg');
const APP = path.join(__dirname, '..', 'src', 'app');

/** Render scale: the master's viewBox is 1500 units; density 150 yields 4167px. */
const RENDER = 4167;

/** Measured bands in the 4167px render (see the band scan in the commit that added this). */
const ART = { x0: 1317, x1: 2849, y0: 1115, y1: 3176 }; // full lockup incl. brush frame
const MONOGRAM = { x0: 1400, x1: 2757, y0: 1366, y1: 2536 }; // the NL only, inside the frame

/** Brand white — used where transparency is not an option (see maskable/apple below). */
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

/**
 * The master paints its background as two full-canvas rects. Removing them yields a
 * transparent render with correct antialiasing — far better than keying out the colour
 * afterwards, which leaves a fringe on every curved edge.
 */
function transparentMaster() {
  const svg = fs.readFileSync(MASTER, 'utf8');
  const stripped = svg.replace(/<rect x="-150"[^>]*fill="#(?:ffffff|f1f1f1)"[^>]*\/>/g, '');
  const removed = (svg.match(/<rect x="-150"[^>]*fill="#(?:ffffff|f1f1f1)"[^>]*\/>/g) || []).length;
  if (removed !== 2) throw new Error(`Expected 2 background rects in the master, removed ${removed}`);
  return Buffer.from(stripped);
}

/**
 * Recolour the tagline ("AFFILIATE MARKETING SYSTEM") to white for dark surfaces.
 * Keyed on desaturation, not brightness: the tagline is pure grey (spread < 30) while the
 * darkest ink in the mark is rgb(4,80,176) — dark (luminance 68) but heavily saturated
 * (spread 172). A brightness threshold would have bleached the L. Verified by census:
 * the mark and the NEXLIFY wordmark contain zero desaturated-dark pixels.
 */
async function taglineToWhite(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a === 0) continue;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (spread < 30 && lum < 120) { data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; }
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
    .png().toBuffer();
}

/**
 * Square canvas with the art centred and `pad` fraction of breathing room each side.
 * The trailing edges take the rounding remainder so the result is EXACTLY `size` —
 * rounding each side independently produced 513px files, which contradicts the sizes
 * declared in manifest.ts and makes the icon a fraction blurry.
 */
async function square(buf, size, pad, background) {
  const inner = Math.round(size * (1 - pad * 2));
  const resized = await sharp(buf)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  const { width, height } = await sharp(resized).metadata();
  const left = Math.floor((size - width) / 2);
  const top = Math.floor((size - height) / 2);
  let img = sharp(resized).extend({
    top, left,
    bottom: size - height - top,
    right: size - width - left,
    background: background || { r: 0, g: 0, b: 0, alpha: 0 },
  });
  if (background) img = img.flatten({ background });
  return img.png().toBuffer();
}

(async () => {
  const master = transparentMaster();
  const full = await sharp(master, { density: 150 }).png().toBuffer();
  const meta = await sharp(full).metadata();
  if (meta.width !== RENDER) throw new Error(`Render is ${meta.width}px, expected ${RENDER}`);

  const crop = (box) => sharp(full)
    .extract({ left: box.x0, top: box.y0, width: box.x1 - box.x0 + 1, height: box.y1 - box.y0 + 1 })
    .png().toBuffer();

  const mark = await crop(MONOGRAM);
  const lockup = await taglineToWhite(await crop(ART));

  // ── In-app + browser: transparent, so the mark sits on any surface, dark or light ──
  fs.writeFileSync(path.join(PUBLIC, 'logo-mark.png'), await square(mark, 512, 0.04));
  // The lockup renders at ~130px on the login hero. Shipping the full 2062px crop meant a
  // 252KB download for it; 900px is still 3.5x the largest display size (retina + growth).
  fs.writeFileSync(path.join(PUBLIC, 'logo-full.png'), await sharp(lockup)
    .resize({ height: 900 }).png({ compressionLevel: 9, palette: true }).toBuffer());
  fs.writeFileSync(path.join(APP, 'icon.png'), await square(mark, 256, 0.04));

  // ── PWA / home screen: solid white. These composite onto the user's wallpaper, and iOS
  //    flattens any transparency to BLACK — which would bury the dark half of the mark.
  //    White is the master's native background, so the mark reads exactly as designed.
  fs.writeFileSync(path.join(PUBLIC, 'icon-192.png'), await square(mark, 192, 0.10, WHITE));
  fs.writeFileSync(path.join(PUBLIC, 'icon-512.png'), await square(mark, 512, 0.10, WHITE));
  fs.writeFileSync(path.join(PUBLIC, 'apple-touch-icon.png'), await square(mark, 180, 0.10, WHITE));
  // Maskable: Android crops to a circle and keeps only the middle ~80%. The extra padding
  // is what stops the N and the L's foot being sliced off at the edges.
  fs.writeFileSync(path.join(PUBLIC, 'icon-maskable-512.png'), await square(mark, 512, 0.22, WHITE));

  for (const f of ['logo-mark.png', 'logo-full.png', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'icon-maskable-512.png']) {
    const m = await sharp(path.join(PUBLIC, f)).metadata();
    console.log(`  public/${f.padEnd(24)} ${String(m.width).padStart(4)}x${String(m.height).padEnd(4)} alpha=${m.hasAlpha}`);
  }
  const im = await sharp(path.join(APP, 'icon.png')).metadata();
  console.log(`  src/app/icon.png${' '.repeat(12)} ${im.width}x${im.height} alpha=${im.hasAlpha}`);
})();
