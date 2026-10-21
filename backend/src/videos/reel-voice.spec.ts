import {
  BASE_SCENE_SECONDS, MAX_SCENE_SECONDS, VOICE_LEAD, buildVoiceTrack, parseWav, readSpeech, speechRequest, speechSpan,
  voiceLines, wordTimes,
} from './reel-voice';
import { REEL_CTA } from './reel-spec';

const RATE = 24000;
/** Silence, then `seconds` of a loud tone, then silence. */
function tone(seconds: number, silence = 0.2): Int16Array {
  const pad = Math.round(silence * RATE);
  const body = Math.round(seconds * RATE);
  const s = new Int16Array(pad + body + pad);
  for (let i = 0; i < body; i++) s[pad + i] = i % 2 ? 8000 : -8000;
  return s;
}
const le = (s: Int16Array) => Buffer.from(s.buffer, s.byteOffset, s.byteLength);

const spec = { headline: 'ידית אחיזה טקטית למסילת פיקטיני', reason: 'אחיזה יציבה לשטח', price: '₪89', was: '₪149', cta: REEL_CTA };

describe('reel voice', () => {
  it('speaks what the screen shows: the headline, the reason, the price in words, the call', () => {
    expect(voiceLines(spec)).toEqual([
      { scene: 'headline', text: spec.headline, display: spec.headline },
      { scene: 'reason', text: 'אחיזה יציבה לשטח', display: 'אחיזה יציבה לשטח' },
      { scene: 'price', text: 'רק 89 שקלים, במקום 149' },
      { scene: 'cta', text: 'הלינק בביו', display: REEL_CTA },
    ]);
    // a cut headline is spoken without its ellipsis; no reason, no line for it
    const lines = voiceLines({ ...spec, headline: 'ידית אחיזה טקטית…', reason: undefined, was: undefined });
    expect(lines.map((l) => l.text)).toEqual(['ידית אחיזה טקטית', 'רק 89 שקלים', 'הלינק בביו']);
  });

  it('asks Gemini TTS for audio in one voice with the delivery as metadata', () => {
    const req = speechRequest('gemini-3.8-flash-tts', 'Kore', 'שלום');
    expect(req.response_format).toEqual({ type: 'audio' });
    expect(req.generation_config.speech_config).toEqual([{ voice: 'Kore' }]);
    expect(req.input[0].content[0]).toMatchObject({ type: 'text', text: 'שלום', annotations: [{ type: 'speech_metadata' }] });
  });

  it('reads raw PCM and WAV answers, and refuses an audio format it cannot time', () => {
    const pcm = tone(0.5);
    const raw = readSpeech({ output_audio: { data: le(pcm).toString('base64'), mime_type: 'audio/L16;codec=pcm;rate=24000' } });
    expect(raw.pcm?.rate).toBe(24000);
    expect(raw.pcm?.samples.length).toBe(pcm.length);

    const track = buildVoiceTrack([{ line: { scene: 'headline', text: 'x' }, pcm: { samples: pcm, rate: RATE } }])!;
    const wav = readSpeech({ steps: [{ type: 'model_output', content: [{ type: 'audio', data: track.wav.toString('base64'), mime_type: 'audio/wav' }] }] });
    expect(wav.pcm?.rate).toBe(RATE);
    expect(parseWav(track.wav)?.samples.length).toBe(Math.ceil(track.timing[4] * RATE));

    expect(readSpeech({ output_audio: { data: 'A'.repeat(400), mime_type: 'audio/mpeg' } }).reason).toMatch(/audio\/mpeg/);
    expect(readSpeech({ status: 'failed', error: { message: 'blocked' } })).toEqual({ pcm: null, reason: 'status failed: blocked' });
  });

  it('finds where the speech is, past the silence the voice starts and ends with', () => {
    const { start, end } = speechSpan({ samples: tone(1, 0.3), rate: RATE });
    expect(start / RATE).toBeCloseTo(0.25, 2);
    expect(end / RATE).toBeCloseTo(1.35, 2);
  });

  it('stretches a scene to fit its line, keeps the silent length for a short one, and caps a runaway', () => {
    const lines = voiceLines(spec);
    const track = buildVoiceTrack([
      { line: lines[0], pcm: { samples: tone(4), rate: RATE } }, // long headline
      { line: lines[1], pcm: { samples: tone(1), rate: RATE } }, // short reason
      { line: lines[2], pcm: { samples: tone(20), rate: RATE } }, // runaway
    ])!;
    const len = (i: number) => track.timing[i + 1] - track.timing[i];
    expect(len(0)).toBeCloseTo(VOICE_LEAD + 4.1 + 0.45, 1);
    expect(len(1)).toBeCloseTo(BASE_SCENE_SECONDS[1], 5);
    expect(len(2)).toBeCloseTo(MAX_SCENE_SECONDS, 5);
    expect(len(3)).toBeCloseTo(BASE_SCENE_SECONDS[3], 5); // no cta line: the silent scene
    // the audio is the Reel's whole length, the line placed after its scene's entrance
    const audio = parseWav(track.wav)!.samples;
    expect(audio.length).toBe(Math.ceil(track.timing[4] * RATE));
    expect(audio[Math.round((VOICE_LEAD - 0.1) * RATE)]).toBe(0);
    expect(Math.abs(audio[Math.round((VOICE_LEAD + 0.2) * RATE)])).toBe(8000);
    // the runaway is cut at its scene's end, not spoken over the next
    expect(audio[Math.round((track.timing[3] + 0.1) * RATE)]).toBe(0);
  });

  it('times every on-screen word inside its line, longer words longer', () => {
    const t = wordTimes('אחיזה יציבה לשטח', 1, 1.5);
    expect(t).toHaveLength(3);
    expect(t[0][0]).toBe(1);
    expect(t[2][1]).toBe(2.5);
    expect(t[0][1]).toBe(t[1][0]);
    const lines = voiceLines(spec);
    const track = buildVoiceTrack([{ line: lines[0], pcm: { samples: tone(2), rate: RATE } }, { line: lines[2], pcm: { samples: tone(1), rate: RATE } }])!;
    expect(track.words.headline).toHaveLength(spec.headline.split(' ').length);
    expect(track.words.price).toBeUndefined(); // the price is spoken, not captioned
  });

  it('nothing to say, or lines at different rates, is no track', () => {
    expect(buildVoiceTrack([])).toBeNull();
    const l = voiceLines(spec);
    expect(buildVoiceTrack([{ line: l[0], pcm: { samples: tone(1), rate: 24000 } }, { line: l[1], pcm: { samples: tone(1), rate: 44100 } }])).toBeNull();
  });
});
