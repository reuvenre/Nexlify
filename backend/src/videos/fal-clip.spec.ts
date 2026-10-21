import { FAL_CLIP_SECONDS, falClipRequest, falJobLinks, falStatus, falVideoUrl, pickClipProvider } from './fal-clip';

describe('fal clip', () => {
  it('alternates the engines when both keys are there, and honours a forced one', () => {
    expect(pickClipProvider({ hasGemini: true, hasFal: true, last: null })).toBe('fal');
    expect(pickClipProvider({ hasGemini: true, hasFal: true, last: 'fal' })).toBe('gemini');
    expect(pickClipProvider({ hasGemini: true, hasFal: true, last: 'gemini' })).toBe('fal');
    expect(pickClipProvider({ hasGemini: true, hasFal: false, last: 'gemini' })).toBe('gemini');
    expect(pickClipProvider({ hasGemini: false, hasFal: true })).toBe('fal');
    expect(pickClipProvider({ hasGemini: false, hasFal: false })).toBeNull();
    expect(pickClipProvider({ setting: 'Gemini', hasGemini: true, hasFal: true, last: 'gemini' })).toBe('gemini');
    expect(pickClipProvider({ setting: 'fal', hasGemini: true, hasFal: false })).toBeNull();
  });

  it('pins the product photo as both the first and the last frame, silent, in its own shape', () => {
    const req = falClipRequest('data:image/jpeg;base64,AAAA', 'Tactical Grip <script>');
    expect(req.start_image_url).toBe('data:image/jpeg;base64,AAAA');
    expect(req.end_image_url).toBe(req.start_image_url);
    expect(req).toMatchObject({ aspect_ratio: 'adaptive', resolution: '720p', duration: FAL_CLIP_SECONDS, audio: false });
    expect(req.prompt).toContain('The product is: Tactical Grip script.');
    expect(req.prompt).toMatch(/identical to the image/);
  });

  it('follows only fal\'s own queue links', () => {
    expect(falJobLinks({ status_url: 'https://queue.fal.run/x/requests/1/status', response_url: 'https://queue.fal.run/x/requests/1' }))
      .toEqual({ status: 'https://queue.fal.run/x/requests/1/status', response: 'https://queue.fal.run/x/requests/1' });
    expect(falJobLinks({ status_url: 'https://evil.example/s', response_url: 'https://queue.fal.run/x' })).toBeNull();
    expect(falJobLinks({ status_url: 'http://queue.fal.run/s', response_url: 'https://queue.fal.run/x' })).toBeNull();
    expect(falJobLinks({})).toBeNull();
  });

  it('reads the queue status and the result', () => {
    expect(falStatus({ status: 'IN_QUEUE' })).toBe('pending');
    expect(falStatus({ status: 'IN_PROGRESS' })).toBe('pending');
    expect(falStatus({ status: 'COMPLETED' })).toBe('done');
    expect(falStatus({ status: 'COMPLETED', error: 'content policy' })).toEqual({ failed: 'content policy' });
    expect(falStatus({ status: 'FAILED' })).toEqual({ failed: 'status FAILED' });
    expect(falVideoUrl({ video: { url: 'https://v3.fal.media/files/a.mp4' } })).toBe('https://v3.fal.media/files/a.mp4');
    expect(falVideoUrl({ video: { url: 'file:///etc/passwd' } })).toBeNull();
  });
});
