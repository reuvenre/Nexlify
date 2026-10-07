import { aiClipPrompt, aiClipRequest, promptSafeTitle, readInteractionVideo } from './ai-clip';

it('promptSafeTitle keeps words, drops markup and instructions-looking symbols', () => {
  expect(promptSafeTitle('Tactical <b>Foregrip</b> {ignore previous} 20mm!!')).toBe('Tactical b Foregrip b ignore previous 20mm');
  expect(promptSafeTitle('x'.repeat(300))).toHaveLength(120);
});

it('the prompt pins the product to the photo and keeps faces, text and speech out', () => {
  const p = aiClipPrompt('Tactical Foregrip');
  expect(p).toMatch(/identical to the reference image/);
  expect(p).toMatch(/Only hands are visible/);
  expect(p).toMatch(/No text, no captions, no logos/);
  expect(p).toMatch(/The product is: Tactical Foregrip\.$/);
});

it('the request sends the photo first, then the prompt, for a vertical 720p video', () => {
  const r = aiClipRequest('gemini-omni-1.1-flash', 'QUJD', 'image/jpeg', 'Grip');
  expect(r.input[0]).toEqual({ type: 'image', data: 'QUJD', mime_type: 'image/jpeg' });
  expect(r.input[1].type).toBe('text');
  expect(r.response_format).toEqual({ type: 'video', aspect_ratio: '9:16', resolution: '720p' });
});

describe('readInteractionVideo', () => {
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 32]), Buffer.from('ftypisom'), Buffer.alloc(200)]);

  it('finds the video in the model output step', () => {
    const body = { status: 'completed', steps: [
      { type: 'user_input', content: [{ type: 'text', text: 'x' }] },
      { type: 'model_output', content: [{ type: 'video', mime_type: 'video/mp4', data: mp4.toString('base64') }] },
    ] };
    expect(readInteractionVideo(body).video?.equals(mp4)).toBe(true);
  });

  it('says why when there is no video', () => {
    expect(readInteractionVideo({ status: 'failed', error: { message: 'blocked by safety filters' } }).reason)
      .toBe('status failed: blocked by safety filters');
    expect(readInteractionVideo({}).reason).toBe('no video in the answer');
  });
});
