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
import { buildComposition } from './composition.mjs';

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
  await fs.writeFile(path.join(WORK, 'index.html'), buildComposition({ ...spec, images }));
  await fs.writeFile(path.join(WORK, 'hyperframes.json'), JSON.stringify({ paths: { assets: 'assets' } }));
  await run('npx', ['--no-install', 'hyperframes', 'render', '--output', 'out.mp4', '--quality', 'looks'], {
    cwd: WORK, env: { ...process.env, HYPERFRAMES_SKIP_SKILLS: '1', DO_NOT_TRACK: '1' },
  });
  const video = await fs.readFile(path.join(WORK, 'out.mp4'));
  console.log(`rendered ${(video.length / 1048576).toFixed(1)} MB — sending back`);
  await fetchOk(RESULT_URL, { method: 'POST', headers: { 'Content-Type': 'video/mp4' }, body: video });
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
