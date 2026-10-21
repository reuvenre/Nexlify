import axios from 'axios';
import { REEL_CTA_EN, buildReelSpecEn } from './reel-spec';
import { voiceLines, speechRequest, VOICE_STYLE_EN } from './reel-voice';
import { DEFAULT_HASHTAGS, shareText } from './reel-share';
import { AI_PIN_NOTE, PIN_DESCRIPTION_MAX, mediaState, uploadTarget, videoPinText } from './pinterest-video';
import { PostsService } from '../posts/posts.service';

const pin = {
  generated_text: [
    '360 Rotating Jewelry Organizer with Earring Holder',
    '',
    'This rotating jewelry organizer keeps earrings and rings tidy on a small vanity. Perfect for dorm rooms and small spaces, just $6.40. Tap to shop.',
    '#homeorganization #jewelrystorage #vanitydecor',
  ].join('\n'),
  product_title: '2024 New Hot Sale Jewelry Box',
  product_image: 'https://ae01.alicdn.com/kf/Smain1.jpg',
  price_ils: 6.4, sale_price_usd: 6.4, original_price_usd: 12.8,
};

describe('the English Reel', () => {
  it('reads the pin copy: its title, a sentence about the product, the price in the campaign currency', () => {
    expect(buildReelSpecEn(pin, '$')).toEqual({
      lang: 'en',
      headline: '360 Rotating Jewelry Organizer with Earring Holder',
      reason: 'This rotating jewelry organizer keeps earrings and rings tidy on a small vanity.',
      price: '$6.40', was: '$12.80', discount: 50,
      cta: REEL_CTA_EN,
      images: ['https://ae01.alicdn.com/kf/Smain1.jpg'],
      hashtags: ['#homeorganization', '#jewelrystorage', '#vanitydecor'],
    });
  });

  it('is not built from Hebrew copy, or without a price', () => {
    expect(buildReelSpecEn({ ...pin, generated_text: 'ידית אחיזה טקטית', product_title: 'ידית' }, '$')).toBeNull();
    expect(buildReelSpecEn({ ...pin, price_ils: 0 }, '$')).toBeNull();
  });

  it('speaks English, with the price as it is shown', () => {
    const spec = buildReelSpecEn(pin, '$')!;
    expect(voiceLines(spec).map((l) => l.text)).toEqual([
      '360 Rotating Jewelry Organizer with Earring Holder',
      'This rotating jewelry organizer keeps earrings and rings tidy on a small vanity.',
      'Just $6.40, down from $12.80.',
      'Tap to shop',
    ]);
    expect(speechRequest('m', 'Kore', 'hi', 'en').input[0].content[0].annotations[0].style).toBe(VOICE_STYLE_EN);
  });

  it('gives TikTok and Shorts the pin\'s own hashtags and points them to the bio', () => {
    const { caption } = shareText(buildReelSpecEn(pin, '$')!, DEFAULT_HASHTAGS, true);
    expect(caption).toContain('💰 $6.40 instead of $12.80\nLink in bio 🔗');
    expect(caption).toContain('#homeorganization #jewelrystorage #vanitydecor');
    expect(caption).not.toContain('#אליאקספרס');
    expect(caption).toMatch(/Video created with AI/);
  });
});

describe('the Pinterest video pin', () => {
  it('takes the pin copy\'s title and description, links dropped, and says when the video is AI', () => {
    const t = videoPinText(`${pin.generated_text}\nhttps://s.click.aliexpress.com/x`, pin.product_title);
    expect(t.title).toBe('360 Rotating Jewelry Organizer with Earring Holder');
    expect(t.description).not.toContain('https://');
    const ai = videoPinText(`Title\n\n${'word '.repeat(200)}`, null, true);
    expect(ai.description.length).toBeLessThanOrEqual(PIN_DESCRIPTION_MAX);
    expect(ai.description.endsWith(AI_PIN_NOTE)).toBe(true);
  });

  it('reads the registered upload and the media status', () => {
    expect(uploadTarget({ media_id: '42', upload_url: 'https://pinterest-media-upload.s3-accelerate.amazonaws.com/', upload_parameters: { key: 'k', policy: 'p' } }))
      .toEqual({ mediaId: '42', url: 'https://pinterest-media-upload.s3-accelerate.amazonaws.com/', fields: { key: 'k', policy: 'p' } });
    expect(uploadTarget({ media_id: '42', upload_url: 'http://x/', upload_parameters: {} })).toBeNull();
    expect(mediaState({ status: 'processing' })).toBe('pending');
    expect(mediaState({ status: 'succeeded' })).toBe('done');
    expect(mediaState({ status: 'failed' })).toEqual({ failed: 'Pinterest media failed' });
  });

  it('registers, uploads, waits, and pins the video to the board with the post\'s destination', async () => {
    process.env.PINTEREST_MEDIA_POLL_MS = '1';
    const svc: any = Object.create(PostsService.prototype);
    svc.repo = { findOne: async () => ({ id: 'p1', user_id: 'u1', ...pin, affiliate_url: 'https://x.app/r/AbC', gallery_json: null }) };
    svc.credentials = { getRaw: async () => ({ pinterest_board_id: 'b1', pinterest_scopes: 'pins:write' }) };
    svc.pinterest = { publishToken: async () => ({ token: 'ptok' }) };
    svc.storefront = { postProductUrl: async () => null };
    let polls = 0;
    const post = jest.spyOn(axios, 'post').mockImplementation(async (url: string) => {
      if (url.endsWith('/v5/media')) return { data: { media_id: 'm1', upload_url: 'https://upload.example/', upload_parameters: { key: 'k' } } };
      if (url === 'https://upload.example/') return { status: 204 };
      if (url.endsWith('/v5/pins')) return { status: 201, data: { id: 'pin9' } };
      throw new Error(`unexpected ${url}`);
    });
    const get = jest.spyOn(axios, 'get').mockImplementation(async () => ({ data: { status: ++polls < 2 ? 'processing' : 'succeeded' } }));
    try {
      const res = await svc.publishPinterestVideo('p1', Buffer.from('mp4'), { aiClip: false });
      expect(res).toEqual({ pin: 'pin9', errors: [] });
      const body = post.mock.calls.find((c) => String(c[0]).endsWith('/v5/pins'))![1] as any;
      expect(body).toMatchObject({
        board_id: 'b1', link: 'https://x.app/r/AbC', title: '360 Rotating Jewelry Organizer with Earring Holder',
        media_source: { source_type: 'video_id', media_id: 'm1', cover_image_url: 'https://ae01.alicdn.com/kf/Smain1.jpg' },
      });
      expect(get.mock.calls[0][0]).toBe('https://api.pinterest.com/v5/media/m1');
    } finally {
      post.mockRestore();
      get.mockRestore();
      delete process.env.PINTEREST_MEDIA_POLL_MS;
    }
  });

  it('a Trial-tier refusal says so, and never throws', async () => {
    process.env.PINTEREST_MEDIA_POLL_MS = '1';
    const svc: any = Object.create(PostsService.prototype);
    svc.repo = { findOne: async () => ({ id: 'p1', user_id: 'u1', ...pin }) };
    svc.credentials = { getRaw: async () => ({ pinterest_board_id: 'b1', pinterest_scopes: 'boards:read,pins:read,pins:write' }) };
    svc.pinterest = { publishToken: async () => ({ token: 'ptok' }) };
    svc.storefront = null;
    const post = jest.spyOn(axios, 'post').mockImplementation(async (url: string) => {
      if (url.endsWith('/v5/media')) return { data: { media_id: 'm1', upload_url: 'https://upload.example/', upload_parameters: {} } };
      if (url.endsWith('/v5/pins')) return { status: 403, data: { message: 'not permitted' } };
      return { status: 204 };
    });
    const get = jest.spyOn(axios, 'get').mockResolvedValue({ data: { status: 'succeeded' } });
    try {
      const res = await svc.publishPinterestVideo('p1', Buffer.from('mp4'));
      expect(res.pin).toBeUndefined();
      expect(res.errors[0]).toMatch(/^Pinterest: /);
    } finally {
      post.mockRestore();
      get.mockRestore();
      delete process.env.PINTEREST_MEDIA_POLL_MS;
    }
  });
});
