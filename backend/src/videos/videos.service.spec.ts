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
  });

  it('a token GitHub refuses is named, and the job fails', async () => {
    post.mockRejectedValue(Object.assign(new Error('403'), { response: { status: 403, data: { message: 'Resource not accessible' } } }));
    const { svc, updates } = build();
    const { error } = await svc.requestReel('p1', 'auto');
    expect(error).toMatch(/Contents: Read and write/);
    expect(updates[0].status).toBe('failed');
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
