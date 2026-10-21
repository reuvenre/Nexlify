import { ReelSpec } from './reel-spec';

/**
 * The Reel's Hebrew voiceover, and the timing the captions follow — pure parts.
 *
 * Reels went out silent: music has licensing of its own. A voice reading our own copy has none,
 * and a viewer with the sound on hears the product instead of nothing. Each scene's line is
 * spoken separately (Gemini TTS through the Interactions endpoint, the account's Gemini key, as
 * the AI clip), so the backend knows how long each one takes: a scene stretches to fit its line,
 * and the on-screen words light up as they are spoken.
 *
 * The words are only ever our published copy and the post's own numbers (reel-spec.ts), so
 * the voice says exactly what the screen shows. Any failure means a silent Reel, never no Reel.
 */

export const VOICE_MODEL_DEFAULT = 'gemini-3.8-flash-tts';
export const VOICE_NAME_DEFAULT = 'Kore';
export const VOICE_STYLE = 'Read aloud in natural Israeli Hebrew, warm and upbeat, like a short social media product ad. Clear and confident, not rushed.';

/** The four scenes, in order (composition.mjs). */
export const SCENE_KEYS = ['headline', 'reason', 'price', 'cta'] as const;
export type SceneKey = typeof SCENE_KEYS[number];
/** Each scene's length without a voice — the silent Reel's 12 s. */
export const BASE_SCENE_SECONDS = [3.2, 3.2, 3.2, 2.4];
/** The line starts this far into its scene, after the scene's own entrance. */
export const VOICE_LEAD = 0.35;
/** And the scene holds this long after the line ends. */
export const VOICE_TAIL = 0.45;
/** A line is never allowed to make its scene longer than this. */
export const MAX_SCENE_SECONDS = 7;

export interface VoiceLine {
  scene: SceneKey;
  /** What is spoken. */
  text: string;
  /** The on-screen text whose words light up while it is spoken (absent for the price). */
  display?: string;
}

const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu;
const spoken = (s: string) => s.replace(EMOJI, '').replace(/…$/, '').replace(/\s+/g, ' ').trim();

/** The lines a Reel's voice reads, one per scene that has something worth saying. */
export function voiceLines(spec: Pick<ReelSpec, 'headline' | 'reason' | 'price' | 'was' | 'cta'>): VoiceLine[] {
  const lines: VoiceLine[] = [];
  if (spoken(spec.headline)) lines.push({ scene: 'headline', text: spoken(spec.headline), display: spec.headline });
  if (spec.reason && spoken(spec.reason)) lines.push({ scene: 'reason', text: spoken(spec.reason), display: spec.reason });
  const n = (s?: string) => String(s || '').replace(/[^\d]/g, '');
  if (n(spec.price)) lines.push({ scene: 'price', text: `רק ${n(spec.price)} שקלים${n(spec.was) ? `, במקום ${n(spec.was)}` : ''}` });
  if (spoken(spec.cta)) lines.push({ scene: 'cta', text: spoken(spec.cta), display: spec.cta });
  return lines;
}

/** One line to Gemini TTS (Interactions): the text, the delivery, one voice, audio out. */
export function speechRequest(model: string, voice: string, text: string) {
  return {
    model,
    input: [{ type: 'user_input', content: [{ type: 'text', text, annotations: [{ type: 'speech_metadata', style: VOICE_STYLE }] }] }],
    response_format: { type: 'audio' },
    generation_config: { speech_config: [{ voice }] },
  };
}

/** Mono 16-bit PCM and its rate. */
export interface Pcm { samples: Int16Array; rate: number }

/** The audio part of an Interactions answer: `output_audio`, or steps[].content[] of type audio. */
function audioPart(body: any): { data: string; mime: string } | null {
  const direct = body?.output_audio;
  if (typeof direct?.data === 'string' && direct.data.length > 100) return { data: direct.data, mime: String(direct.mime_type || '') };
  for (const step of Array.isArray(body?.steps) ? body.steps : []) {
    for (const part of Array.isArray(step?.content) ? step.content : []) {
      if (part?.type === 'audio' && typeof part.data === 'string' && part.data.length > 100) {
        return { data: part.data, mime: String(part.mime_type || '') };
      }
    }
  }
  return null;
}

function toMono(raw: Buffer, channels: number): Int16Array {
  const frames = Math.floor(raw.length / (2 * channels));
  const out = new Int16Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += raw.readInt16LE((i * channels + c) * 2);
    out[i] = Math.round(sum / channels);
  }
  return out;
}

/** A RIFF/WAVE file's 16-bit PCM, or null when it is something else. */
export function parseWav(buf: Buffer): Pcm | null {
  if (buf.length < 44 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') return null;
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  for (let at = 12; at + 8 <= buf.length;) {
    const id = buf.toString('latin1', at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === 'fmt ') {
      fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    } else if (id === 'data') {
      if (!fmt || fmt.format !== 1 || fmt.bits !== 16 || fmt.channels < 1) return null;
      return { samples: toMono(buf.subarray(body, Math.min(buf.length, body + size)), fmt.channels), rate: fmt.rate };
    }
    at = body + size + (size % 2);
  }
  return null;
}

/**
 * The speech out of a TTS answer, as mono PCM. Gemini sends a WAV file or raw little-endian
 * 16-bit PCM (`audio/L16;rate=24000`, `audio/pcm`). Anything else is refused with the reason,
 * since the timing below needs to count samples.
 */
export function readSpeech(body: any): { pcm: Pcm | null; reason?: string } {
  const part = audioPart(body);
  if (!part) {
    const status = body?.status ? `status ${body.status}` : 'no audio in the answer';
    return { pcm: null, reason: body?.error?.message ? `${status}: ${String(body.error.message).slice(0, 200)}` : status };
  }
  const buf = Buffer.from(part.data, 'base64');
  const wav = parseWav(buf);
  if (wav) return { pcm: wav };
  if (/l16|pcm/i.test(part.mime) || !part.mime) {
    const rate = Number(part.mime.match(/rate=(\d+)/i)?.[1]) || 24000;
    const channels = Number(part.mime.match(/channels=(\d+)/i)?.[1]) || 1;
    return { pcm: { samples: toMono(buf, channels), rate } };
  }
  return { pcm: null, reason: `פורמט שמע לא נתמך (${part.mime})` };
}

/** Where the speech is: the first and last sample above the noise floor, in samples. */
export function speechSpan(pcm: Pcm, floor = 600): { start: number; end: number } {
  const s = pcm.samples;
  let start = 0;
  while (start < s.length && Math.abs(s[start]) < floor) start++;
  let end = s.length;
  while (end > start && Math.abs(s[end - 1]) < floor) end--;
  // Keep a breath either side, so a soft first or last syllable is not clipped.
  const pad = Math.round(pcm.rate * 0.05);
  return { start: Math.max(0, start - pad), end: Math.min(s.length, end + pad) };
}

/**
 * When each word of a line is spoken. TTS gives no word timestamps, so the line's spoken span
 * is shared out by each word's letters (plus a beat per word): close enough for a caption that
 * lights a word up as it is said, and exact at both ends.
 */
export function wordTimes(display: string, at: number, length: number): number[][] {
  const words = display.split(/\s+/).filter(Boolean);
  const weight = words.map((w) => (w.match(/[\p{L}\p{N}]/gu) || []).length + 1);
  const total = weight.reduce((a, b) => a + b, 0) || 1;
  let t = at;
  const r = (x: number) => Math.round(x * 100) / 100;
  return words.map((_, i) => {
    const d = (length * weight[i]) / total;
    const span = [r(t), r(t + d)];
    t += d;
    return span;
  });
}

export interface VoiceTrack {
  /** The whole Reel's audio, one mono 16-bit WAV, as long as the Reel. */
  wav: Buffer;
  /** Scene starts plus the end: [0, s1, s2, s3, end]. */
  timing: number[];
  /** Per scene with on-screen words: each word's [start, end] in seconds. */
  words: Partial<Record<SceneKey, number[][]>>;
}

function wavFile(samples: Int16Array, rate: number): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(samples[i], i * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVE', 8, 'latin1');
  head.write('fmt ', 12, 'latin1');
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36, 'latin1');
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

/**
 * The spoken lines laid on the Reel's timeline: each scene as long as its line needs (never
 * shorter than the silent Reel's, never longer than MAX_SCENE_SECONDS), the line placed
 * VOICE_LEAD into its scene, and one WAV the length of the whole Reel.
 */
export function buildVoiceTrack(spoken: Array<{ line: VoiceLine; pcm: Pcm }>): VoiceTrack | null {
  if (!spoken.length) return null;
  const rate = spoken[0].pcm.rate;
  if (spoken.some((s) => s.pcm.rate !== rate)) return null;
  const parts = new Map(spoken.map(({ line, pcm }) => {
    const { start, end } = speechSpan(pcm);
    return [line.scene, { line, samples: pcm.samples.subarray(start, end) }] as const;
  }));
  const r = (x: number) => Math.round(x * 100) / 100;
  const timing: number[] = [0];
  SCENE_KEYS.forEach((key, i) => {
    const p = parts.get(key);
    const need = p ? VOICE_LEAD + p.samples.length / rate + VOICE_TAIL : 0;
    timing.push(r(timing[i] + Math.min(MAX_SCENE_SECONDS, Math.max(BASE_SCENE_SECONDS[i], need))));
  });
  const out = new Int16Array(Math.ceil(timing[SCENE_KEYS.length] * rate));
  const words: VoiceTrack['words'] = {};
  SCENE_KEYS.forEach((key, i) => {
    const p = parts.get(key);
    if (!p) return;
    const at = timing[i] + VOICE_LEAD;
    // A line longer than its capped scene is cut at the scene's end, not spoken over the next.
    const offset = Math.round(at * rate);
    const room = Math.max(0, Math.min(Math.floor((timing[i + 1] - at) * rate), out.length - offset));
    const take = p.samples.subarray(0, Math.min(p.samples.length, room));
    out.set(take, offset);
    if (p.line.display) words[key] = wordTimes(p.line.display, at, take.length / rate);
  });
  return { wav: wavFile(out, rate), timing, words };
}
