#!/usr/bin/env node
/**
 * Render one product Reel and send it back — run by .github/workflows/render-video.yml.
 *
 *   SPEC_URL    the backend's /videos/jobs/<id>/spec?t=… (the reel-spec.ts JSON)
 *   RESULT_URL  the backend's /videos/jobs/<id>/result?t=… (POST the MP4 there)
 *
 * The photos are downloaded first and referenced as local assets, so the render never
 * depends on a CDN answering mid-capture. Any failure is reported to …/failed, so the owner
 * hears about it instead of waiting for a timeout.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { CLIP_END, buildComposition } from './composition.mjs';

const { SPEC_URL, RESULT_URL } = process.env;
const WORK = path.resolve(process.env.WORK_DIR || 'work');

async function fetchOk(url, init) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${init?.method || 'GET'} ${new URL(url).pathname} → HTTP ${res.status}`);
  return res;
}

async function download(url, file) {
  const res = await fetchOk(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Nexlify reel renderer)' } });
  const type = res.headers.get('content-type') || '';
  if (!/^image\//.test(type)) throw new Error(`not an image (${type || 'no type'})`);
  const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
  const name = `${file}.${ext}`;
  await fs.writeFile(path.join(WORK, 'assets', name), Buffer.from(await res.arrayBuffer()));
  return `assets/${name}`;
}

/**
 * The opening clip (the seller's video, or the backend's AI clip): downloaded, cut to the
 * part the Reel shows, scaled, silent, H.264 — so the render never seeks a 60 s seller video
 * or chokes on an odd codec. Any failure means a photo-only Reel, never no Reel.
 */
async function prepareClip(url) {
  try {
    const res = await fetchOk(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Nexlify reel renderer)' } });
    const raw = path.join(WORK, 'clip-source');
    await fs.writeFile(raw, Buffer.from(await res.arrayBuffer()));
    await run('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-t', String(CLIP_END + 0.3), '-an',
      '-vf', "scale='min(1080,iw)':-2", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p',
      path.join(WORK, 'assets', 'clip.mp4')]);
    await fs.rm(raw, { force: true });
    return 'assets/clip.mp4';
  } catch (e) {
    console.warn(`clip skipped, photos only: ${e.message}`);
    return null;
  }
}

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', ...opts });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args[0]} exited ${code}`))));
  });
}

async function main() {
  if (!SPEC_URL || !RESULT_URL) throw new Error('SPEC_URL / RESULT_URL missing');
  await fs.mkdir(path.join(WORK, 'assets'), { recursive: true });
  const spec = await (await fetchOk(SPEC_URL)).json();
  const images = [];
  for (const [i, url] of (spec.images || []).slice(0, 3).entries()) {
    try { images.push(await download(url, `p${i + 1}`)); } catch (e) { console.warn(`image ${i + 1} skipped: ${e.message}`); }
  }
  if (!images.length) throw new Error('none of the product photos could be downloaded');
  const video = spec.video ? await prepareClip(spec.video) : null;
  await fs.writeFile(path.join(WORK, 'index.html'), buildComposition({ ...spec, images, video: video || undefined, ai: !!(video && spec.ai) }));
  await fs.writeFile(path.join(WORK, 'hyperframes.json'), JSON.stringify({ paths: { assets: 'assets' } }));
  await run('npx', ['--no-install', 'hyperframes', 'render', '--output', 'out.mp4', '--quality', 'looks', '--crf', '23'], {
    cwd: WORK, env: { ...process.env, HYPERFRAMES_SKIP_SKILLS: '1', DO_NOT_TRACK: '1' },
  });
  const out = await fs.readFile(path.join(WORK, 'out.mp4'));
  console.log(`rendered ${(out.length / 1048576).toFixed(1)} MB${video ? ' with the clip' : ''} — sending back`);
  // The backend must know whether the clip made it: an AI label in the caption for a Reel
  // that fell back to photos would be a false statement.
  const sep = RESULT_URL.includes('?') ? '&' : '?';
  await fetchOk(`${RESULT_URL}${sep}clip=${video ? (spec.ai ? 'ai' : 'seller') : 'none'}`, {
    method: 'POST', headers: { 'Content-Type': 'video/mp4' }, body: out,
  });
  console.log('delivered');
}

main().catch(async (err) => {
  console.error(`render failed: ${err.message}`);
  if (RESULT_URL) {
    const failedUrl = RESULT_URL.replace('/result?', '/failed?');
    await fetch(failedUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message }),
    }).catch(() => {});
  }
  process.exit(1);
});
