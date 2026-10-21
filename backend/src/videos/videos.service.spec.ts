import axios from 'axios';
import { VideosService, looksLikeMp4 } from './videos.service';

const ID = '11111111-2222-3333-4444-555555555555';
const WT = 'a'.repeat(48);
const MT = 'b'.repeat(48);

function build(job: any = null) {
  const saved: any[] = [];
  const updates: any[] = [];
  const jobs: any = {
    create: (x: any) => x,
    save: async (x: any) => { const j = { ...x, id: ID, worker_token: WT, media_token: MT }; saved.push(j); return j; },
    update: async (_w: any, x: any) => { updates.push(x); },
    findOne: async () => job,
  };
  const post = { id: 'p1', user_id: 'u1', channel_override: 'g1', generated_text: 'ידית אחיזה טקטית למסילת פיקטיני', price_ils: 89, product_image: 'https://a/kf/S1.jpg' };
  const postsRepo: any = { findOne: async () => post };
  const channels: any = { getName: async () => 'טקטי בקליק' };
  const svc = new VideosService(jobs, postsRepo, {} as any, channels, { getTelegramToken: async () => null } as any);
  return { svc, saved, updates };
}

describe('VideosService', () => {
  const env = { ...process.env };
  let post: jest.SpyInstance;
  beforeEach(() => {
    process.env.BACKEND_URL = 'https://api.example.com/';
    process.env.GITHUB_RENDER_TOKEN = 'ghtok';
    process.env.GITHUB_RENDER_REPO = 'owner/repo';
    post = jest.spyOn(axios, 'post');
  });
  afterEach(() => { post.mockRestore(); process.env = { ...env }; });

  it('dispatches the render with the job\'s own links, and marks it rendering', async () => {
    post.mockResolvedValue({ status: 204 });
    const { svc, saved, updates } = build();
    const { error } = await svc.requestReel('p1', 'owner');
    expect(error).toBeUndefined();
    expect(saved[0].spec.brand).toBe('טקטי בקליק');
    const [url, body, cfg] = post.mock.calls[0] as any[];
    expect(url).toBe('https://api.github.com/repos/owner/repo/dispatches');
    expect(body.event_type).toBe('render-video');
    expect(body.client_payload.spec_url).toBe(`https://api.example.com/videos/jobs/${ID}/spec?t=${WT}`);
    expect(body.client_payload.result_url).toBe(`https://api.example.com/videos/jobs/${ID}/result?t=${WT}`);
    expect(cfg.headers.Authorization).toBe('Bearer ghtok');
    expect(updates).toEqual([{ status: 'rendering' }]);
    expect(saved[0].spec.video).toBeUndefined();
  });

  it('a token GitHub refuses is named, and the job fails', async () => {
    post.mockRejectedValue(Object.assign(new Error('403'), { response: { status: 403, data: { message: 'Resource not accessible' } } }));
    const { svc, updates } = build();
    const { error } = await svc.requestReel('p1', 'auto');
    expect(error).toMatch(/Contents: Read and write על owner\/repo \(403\)/);
    expect(updates.at(-1).status).toBe('failed');
  });

  it('no token, no dispatch', async () => {
    delete process.env.GITHUB_RENDER_TOKEN;
    delete process.env.GITHUB_WATCHDOG_TOKEN;
    const { svc } = build();
    expect((await svc.requestReel('p1', 'auto')).error).toMatch(/GITHUB_RENDER_TOKEN/);
    expect(post).not.toHaveBeenCalled();
  });

  it('serves the spec only with the worker token, and only while rendering', async () => {
    const job = { id: ID, status: 'rendering', worker_token: WT, media_token: MT, spec: { headline: 'x' } };
    expect(await build(job).svc.specFor(ID, WT)).toEqual({ headline: 'x' });
    expect(await build(job).svc.specFor(ID, MT)).toBeNull();
    expect(await build({ ...job, status: 'published' }).svc.specFor(ID, WT)).toBeNull();
    expect(await build(job).svc.specFor('../etc', WT)).toBeNull();
  });

  it('refuses a result that is not an MP4', async () => {
    const job = { id: ID, status: 'rendering', worker_token: WT, media_token: MT, spec: {} };
    const { svc, updates } = build(job);
    expect(await svc.acceptResult(ID, WT, Buffer.from('<html>error</html>'))).toBe('not an mp4');
    expect(updates[0].status).toBe('failed');
  });
});

it('looksLikeMp4', () => {
  expect(looksLikeMp4(Buffer.from('\x00\x00\x00\x20ftypisom0000', 'latin1'))).toBe(true);
  expect(looksLikeMp4(Buffer.from('<!doctype html><html>'))).toBe(false);
});

describe('VideosService — the AI clip when there is no seller video', () => {
  const env = { ...process.env };
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 32]), Buffer.from('ftypisom'), Buffer.alloc(300)]);
  let post: jest.SpyInstance;
  let get: jest.SpyInstance;
  afterEach(() => { post.mockRestore(); get.mockRestore(); process.env = { ...env }; });

  function buildAi(opts: { sellerVideo?: string } = {}) {
    process.env.BACKEND_URL = 'https://api.example.com';
    process.env.GITHUB_RENDER_TOKEN = 'ghtok';
    process.env.REELS_AI_VIDEO = '1';
    let job: any = null;
    const updates: any[] = [];
    const jobs: any = {
      create: (x: any) => x,
      save: async (x: any) => { job = { ...x, id: ID, worker_token: WT, media_token: MT }; return job; },
      update: async (_w: any, x: any) => { updates.push(x); job = { ...job, ...x }; },
      findOne: async () => job,
      query: async () => [{ n: 0 }],
    };
    const p = { id: 'p1', user_id: 'u1', generated_text: 'ידית אחיזה טקטית למסילת פיקטיני', price_ils: 89,
      product_image: 'https://a/kf/S1.jpg', product_title: 'Tactical Grip', product_video: opts.sellerVideo || null };
    const svc = new VideosService(jobs, { findOne: async () => p } as any, {} as any, { getName: async () => null } as any,
      { getRaw: async () => ({ gemini_api_key: 'gkey' }), getTelegramToken: async () => null } as any);
    get = jest.spyOn(axios, 'get').mockResolvedValue({ data: Buffer.from('jpeg'), headers: { 'content-type': 'image/jpeg' } });
    post = jest.spyOn(axios, 'post');
    return { svc, updates, current: () => job };
  }
  const flush = () => new Promise((r) => setTimeout(r, 20));

  it('generates the clip, points the spec at it, labels it AI, then renders', async () => {
    const { svc, updates, current } = buildAi();
    post.mockImplementation(async (url: string, body: any) => {
      if (url.includes('generativelanguage')) {
        expect(body.model).toBe('gemini-omni-1.1-flash');
        expect(body.response_format.aspect_ratio).toBe('9:16');
        return { data: { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'video', data: mp4.toString('base64') }] }] } };
      }
      return { status: 204 };
    });
    await svc.requestReel('p1', 'owner');
    expect(updates[0]).toEqual({ status: 'generating' });
    await flush();
    expect(current().spec.video).toBe(`https://api.example.com/videos/jobs/${ID}/clip.mp4?t=${WT}`);
    expect(current().spec.ai).toBe(true);
    expect(current().status).toBe('rendering');
    expect(post.mock.calls.map((c) => c[0])).toEqual([
      'https://generativelanguage.googleapis.com/v1beta/interactions',
      'https://api.github.com/repos/reuvenre/Nexlify/dispatches',
    ]);
  });

  it('a failed clip still renders — from the photos, with a note for the owner', async () => {
    const { svc, current } = buildAi();
    post.mockImplementation(async (url: string) => {
      if (url.includes('generativelanguage')) throw Object.assign(new Error('400'), { response: { status: 400, data: { error: { message: 'blocked' } } } });
      return { status: 204 };
    });
    await svc.requestReel('p1', 'auto');
    await flush();
    expect(current().spec.video).toBeUndefined();
    expect(current().status).toBe('rendering');
    expect(current().error).toMatch(/קליפ ה-AI \(Gemini\) לא נוצר \(400 blocked\)/);
  });

  it("a seller video skips the AI entirely — real footage first", async () => {
    const { svc, updates } = buildAi({ sellerVideo: 'https://video.aliexpress-media.com/1.mp4' });
    post.mockResolvedValue({ status: 204 });
    await svc.requestReel('p1', 'auto');
    expect(updates).toEqual([{ status: 'rendering' }]);
    expect(post.mock.calls.every((c) => !String(c[0]).includes('generativelanguage'))).toBe(true);
  });
});

describe('VideosService — the Hebrew voiceover', () => {
  const env = { ...process.env };
  let post: jest.SpyInstance;
  afterEach(() => { post.mockRestore(); process.env = { ...env }; });

  function buildVoice() {
    process.env.BACKEND_URL = 'https://api.example.com';
    process.env.GITHUB_RENDER_TOKEN = 'ghtok';
    process.env.REELS_VOICE = '1';
    let job: any = null;
    const jobs: any = {
      create: (x: any) => x,
      save: async (x: any) => { job = { ...x, id: ID, worker_token: WT, media_token: MT }; return job; },
      update: async (_w: any, x: any) => { job = { ...job, ...x }; },
      findOne: async () => job,
      query: async () => [{ n: 0 }],
    };
    const p = { id: 'p1', user_id: 'u1', generated_text: 'ידית אחיזה טקטית למסילת פיקטיני\nאחיזה יציבה לשטח הפתוח', price_ils: 89,
      product_image: 'https://a/kf/S1.jpg', product_title: 'Tactical Grip', product_video: 'https://v/1.mp4' };
    const svc = new VideosService(jobs, { findOne: async () => p } as any, {} as any, { getName: async () => null } as any,
      { getRaw: async () => ({ gemini_api_key: 'gkey' }), getTelegramToken: async () => null } as any);
    post = jest.spyOn(axios, 'post');
    return { svc, current: () => job };
  }
  const flush = () => new Promise((r) => setTimeout(r, 30));
  const speech = () => {
    const s = new Int16Array(24000 * 2).map((_, i) => (i % 2 ? 6000 : -6000));
    return { data: { output_audio: { data: Buffer.from(s.buffer).toString('base64'), mime_type: 'audio/L16;rate=24000' } } };
  };

  it('speaks each scene, stretches the timing to fit, serves the WAV, then renders', async () => {
    const { svc, current } = buildVoice();
    const spoken: string[] = [];
    post.mockImplementation(async (url: string, body: any) => {
      if (url.includes('generativelanguage')) { spoken.push(body.input[0].content[0].text); return speech(); }
      return { status: 204 };
    });
    await svc.requestReel('p1', 'owner');
    await flush();
    expect(spoken).toEqual(['ידית אחיזה טקטית למסילת פיקטיני', 'אחיזה יציבה לשטח הפתוח', 'רק 89 שקלים', 'הלינק בביו']);
    const job = current();
    expect(job.status).toBe('rendering');
    expect(job.spec.voice).toBe(`https://api.example.com/videos/jobs/${ID}/voice.wav?t=${WT}`);
    expect(job.spec.video).toBe('https://v/1.mp4'); // the seller's video stays
    expect(job.spec.timing).toHaveLength(5);
    expect(job.spec.timing[1]).toBeGreaterThan(2.5); // 2 s of speech + lead + tail
    expect(job.spec.words.headline).toHaveLength(5);
    expect(job.voice.toString('latin1', 0, 4)).toBe('RIFF');
    expect(post.mock.calls.at(-1)[0]).toBe('https://api.github.com/repos/reuvenre/Nexlify/dispatches');
  });

  it('a voice that fails leaves a silent Reel with a note, never no Reel', async () => {
    const { svc, current } = buildVoice();
    post.mockImplementation(async (url: string) => {
      if (url.includes('generativelanguage')) return { data: { status: 'failed', error: { message: 'language not supported' } } };
      return { status: 204 };
    });
    await svc.requestReel('p1', 'auto');
    await flush();
    expect(current().status).toBe('rendering');
    expect(current().spec.voice).toBeUndefined();
    expect(current().error).toMatch(/הקריינות לא נוצרה \(status failed: language not supported\)/);
  });

  it('records whether the finished Reel carries the voice', async () => {
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 32]), Buffer.from('ftypisom'), Buffer.alloc(300)]);
    const updates: any[] = [];
    const job = { id: ID, status: 'rendering', worker_token: WT, media_token: MT, spec: {} };
    const jobs: any = { update: async (_w: any, x: any) => { updates.push(x); }, findOne: async () => job };
    const svc = new VideosService(jobs, {} as any, {} as any, {} as any, {} as any);
    jest.spyOn(svc, 'publish').mockResolvedValue();
    await svc.acceptResult(ID, WT, mp4, 'seller', '1');
    expect(updates[0]).toMatchObject({ status: 'ready', has_voice: true, voice: null });
  });
});

describe('VideosService — the file for TikTok and Shorts', () => {
  const env = { ...process.env };
  let post: jest.SpyInstance;
  afterEach(() => { post.mockRestore(); process.env = { ...env }; });

  function buildShare(opts: { video?: Buffer | null } = {}) {
    process.env.BACKEND_URL = 'https://api.example.com';
    process.env.WATCHDOG_TELEGRAM_CHAT_ID = '42';
    process.env.WATCHDOG_TELEGRAM_BOT_TOKEN = 'bot';
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 32]), Buffer.from('ftypisom'), Buffer.alloc(300)]);
    const job: any = { id: ID, user_id: 'u1', post_id: 'p1', status: 'ready', media_token: MT, clip_source: 'none', has_voice: true,
      spec: { headline: 'ידית אחיזה טקטית', price: '₪89', cta: 'הלינק בביו 🔗', brand: 'טקטי בקליק' } };
    const jobs: any = {
      findOne: async () => job, update: async () => {},
      createQueryBuilder: () => ({ addSelect() { return this; }, where() { return this; }, getOne: async () => ({ video: opts.video === undefined ? mp4 : opts.video }) }),
    };
    const posts: any = { publishReel: async () => ({ instagram: 'ig1', errors: [] }) };
    const svc = new VideosService(jobs, {} as any, posts, {} as any, {} as any);
    post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { ok: true } });
    return svc;
  }

  it('sends the MP4 with the outcome as its caption, then the paste-ready text', async () => {
    await buildShare().publish(ID);
    const urls = post.mock.calls.map((c) => c[0]);
    expect(urls).toEqual(['https://api.telegram.org/botbot/sendVideo', 'https://api.telegram.org/botbot/sendMessage']);
    const text = post.mock.calls[1][1].text;
    expect(text).toMatch(/^ידית אחיזה טקטית\n💰 ₪89\nהלינק בביו 🔗\n\n#טקטי_בקליק #אליאקספרס/);
    expect(text).toMatch(/כותרת ל-Shorts:\nידית אחיזה טקטית #shorts$/);
  });

  it('no file to send: the plain line, as before', async () => {
    await buildShare({ video: null }).publish(ID);
    expect(post.mock.calls.map((c) => c[0])).toEqual(['https://api.telegram.org/botbot/sendMessage']);
    expect(post.mock.calls[0][1].text).toMatch(/🎬 Reel פורסם באינסטגרם/);
    expect(post.mock.calls[0][1].text).toMatch(/🔊 עם קריינות בעברית/);
  });

  it('a refused upload falls back to the plain line', async () => {
    const svc = buildShare();
    post.mockImplementation(async (url: string) => {
      if (url.endsWith('/sendVideo')) throw Object.assign(new Error('413'), { response: { data: { description: 'Request Entity Too Large' } } });
      return { data: { ok: true } };
    });
    await svc.publish(ID);
    expect(post.mock.calls.map((c) => c[0])).toEqual(['https://api.telegram.org/botbot/sendVideo', 'https://api.telegram.org/botbot/sendMessage']);
    expect(post.mock.calls[1][1].text).toMatch(/^🎬 Reel פורסם/);
  });
});

describe('VideosService — the fal clip', () => {
  const env = { ...process.env };
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 32]), Buffer.from('ftypisom'), Buffer.alloc(300)]);
  let post: jest.SpyInstance;
  let get: jest.SpyInstance;
  afterEach(() => { post.mockRestore(); get.mockRestore(); process.env = { ...env }; });

  function buildFal(last: string | null, keys: Record<string, string>) {
    process.env.BACKEND_URL = 'https://api.example.com';
    process.env.GITHUB_RENDER_TOKEN = 'ghtok';
    process.env.REELS_AI_VIDEO = '1';
    process.env.REELS_FAL_POLL_MS = '1';
    let job: any = null;
    const jobs: any = {
      create: (x: any) => x,
      save: async (x: any) => { job = { ...x, id: ID, worker_token: WT, media_token: MT }; return job; },
      update: async (_w: any, x: any) => { job = { ...job, ...x }; },
      findOne: async () => job,
      query: async (sql: string) => (sql.includes('clip_provider') ? (last ? [{ clip_provider: last }] : []) : [{ n: 0 }]),
    };
    const p = { id: 'p1', user_id: 'u1', generated_text: 'ידית אחיזה טקטית למסילת פיקטיני', price_ils: 89,
      product_image: 'https://a/kf/S1.jpg', product_title: 'Tactical Grip', product_video: null };
    const svc = new VideosService(jobs, { findOne: async () => p } as any, {} as any, { getName: async () => null } as any,
      { getRaw: async () => keys, getTelegramToken: async () => null } as any);
    let polls = 0;
    get = jest.spyOn(axios, 'get').mockImplementation(async (url: string) => {
      if (url.endsWith('/status')) return { data: { status: ++polls < 2 ? 'IN_PROGRESS' : 'COMPLETED' } };
      if (url === 'https://queue.fal.run/alibaba/wan-3.0/requests/r1') return { data: { video: { url: 'https://v3.fal.media/files/c.mp4' } } };
      if (url === 'https://v3.fal.media/files/c.mp4') return { data: mp4 };
      return { data: Buffer.from('jpeg'), headers: { 'content-type': 'image/jpeg' } };
    });
    post = jest.spyOn(axios, 'post').mockImplementation(async (url: string, body: any, cfg: any) => {
      if (url.startsWith('https://queue.fal.run/')) {
        expect(cfg.headers.Authorization).toBe('Key fkey');
        expect(body.start_image_url).toBe(`data:image/jpeg;base64,${Buffer.from('jpeg').toString('base64')}`);
        return { data: { request_id: 'r1', status_url: 'https://queue.fal.run/alibaba/wan-3.0/requests/r1/status', response_url: 'https://queue.fal.run/alibaba/wan-3.0/requests/r1' } };
      }
      if (url.includes('generativelanguage')) {
        return { data: { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'video', data: mp4.toString('base64') }] }] } };
      }
      return { status: 204 };
    });
    return { svc, current: () => job };
  }
  const flush = () => new Promise((r) => setTimeout(r, 50));

  it('after a Gemini clip, the next Reel opens with fal: the photo brought to life, in the card', async () => {
    const { svc, current } = buildFal('gemini', { gemini_api_key: 'gkey', fal_api_key: 'fkey' });
    await svc.requestReel('p1', 'owner');
    await flush();
    expect(post.mock.calls[0][0]).toBe('https://queue.fal.run/alibaba/wan-3.0/image-to-video');
    expect(current()).toMatchObject({ status: 'rendering', clip_provider: 'fal', clip: mp4 });
    expect(current().spec).toMatchObject({ ai: true, fit: 'card', video: `https://api.example.com/videos/jobs/${ID}/clip.mp4?t=${WT}` });
  });

  it('after a fal clip, Gemini — the two alternate', async () => {
    const { svc, current } = buildFal('fal', { gemini_api_key: 'gkey', fal_api_key: 'fkey' });
    await svc.requestReel('p1', 'owner');
    await flush();
    expect(post.mock.calls[0][0]).toContain('generativelanguage');
    expect(current()).toMatchObject({ clip_provider: 'gemini' });
    expect(current().spec.fit).toBe('full');
  });

  it('fal only: fal every time', async () => {
    const { svc, current } = buildFal('fal', { fal_api_key: 'fkey' });
    await svc.requestReel('p1', 'auto');
    await flush();
    expect(current().clip_provider).toBe('fal');
  });
});
