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
    expect(current().error).toMatch(/קליפ ה-AI לא נוצר \(400 blocked\)/);
  });

  it("a seller video skips the AI entirely — real footage first", async () => {
    const { svc, updates } = buildAi({ sellerVideo: 'https://video.aliexpress-media.com/1.mp4' });
    post.mockResolvedValue({ status: 204 });
    await svc.requestReel('p1', 'auto');
    expect(updates).toEqual([{ status: 'rendering' }]);
    expect(post.mock.calls.every((c) => !String(c[0]).includes('generativelanguage'))).toBe(true);
  });
});
