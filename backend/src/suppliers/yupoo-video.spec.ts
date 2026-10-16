import * as cheerio from 'cheerio';
import { collectYupooVideos, isYupooVideoUrl, parseVideos, yupooVideoUrl } from './yupoo-video';

// The markup of a real album (minkang, album 231421137), trimmed: one video in the gallery,
// the same video again in the viewer strip, and a photo.
const ALBUM = `
<div class="showalbum__children image__main" data-id="79810510">
  <div class="image__imagewrap" data-type="video">
    <img alt="d7bed7a3ab197880085a0d06c9b5b8ae.mp4"
      data-src="https://uvd.yupoo.com/minkang/13591294_thumb.jpg"
      data-origin-src="https://uvd.yupoo.com/minkang/13591294_thumb.jpg"
      data-type="video" data-album-id="231421137"
      data-videoformats="v1080p,v720p,v480p"
      data-path="/minkang/13591294.mp4"
      src="https://uvd.yupoo.com/minkang/13591294_thumb.jpg">
  </div>
</div>
<div class="showalbum__children image__main" data-id="1">
  <img data-type="photo" data-src="https://photo.yupoo.com/minkang/2df7a87e/medium.jpg">
</div>
<div class="viewer__thumbnail">
  <img title="d7bed7a3ab197880085a0d06c9b5b8ae.mp4" data-type="video"
    data-src="https://uvd.yupoo.com/minkang/13591294_thumb.jpg">
</div>`;

const videosOf = (html: string) => {
  const $ = cheerio.load(html);
  return collectYupooVideos($('img[data-type="video"]').toArray().map((el) => (n: string) => $(el).attr(n)));
};

describe('yupooVideoUrl', () => {
  it('builds the rendition URL the Yupoo player uses, 720p first', () => {
    expect(yupooVideoUrl('/minkang/13591294.mp4', 'v1080p,v720p,v480p'))
      .toBe('https://uvd.yupoo.com/720p/minkang/13591294.mp4');
  });

  it('takes the next preferred rendition when 720p is missing', () => {
    expect(yupooVideoUrl('/s/1.mp4', 'v1080p,v480p')).toBe('https://uvd.yupoo.com/480p/s/1.mp4');
    expect(yupooVideoUrl('/s/1.mp4', 'v1080p')).toBe('https://uvd.yupoo.com/1080p/s/1.mp4');
  });

  it('plays a transcoded rendition as mp4 even when the upload was a .mov', () => {
    expect(yupooVideoUrl('/s/clip.mov', 'v720p')).toBe('https://uvd.yupoo.com/720p/s/clip.mp4');
  });

  it('falls back to the upload only when it already is an mp4', () => {
    expect(yupooVideoUrl('/s/1.mp4', 'transcoding')).toBe('https://uvd.yupoo.com/s/1.mp4');
    expect(yupooVideoUrl('/s/1.mp4', '')).toBe('https://uvd.yupoo.com/s/1.mp4');
    expect(yupooVideoUrl('/s/1.mov', 'transcoding')).toBeNull();
    expect(yupooVideoUrl('/s/1.mov', 'fail')).toBeNull();
  });

  it('refuses a missing path, a full URL or a path that climbs out', () => {
    expect(yupooVideoUrl('', 'v720p')).toBeNull();
    expect(yupooVideoUrl(undefined, 'v720p')).toBeNull();
    expect(yupooVideoUrl('https://evil.example/x.mp4', 'v720p')).toBeNull();
    expect(yupooVideoUrl('/../x.mp4', 'v720p')).toBeNull();
  });
});

describe('collectYupooVideos', () => {
  it('finds the album video once, with its cover, and ignores photos', () => {
    expect(videosOf(ALBUM)).toEqual([{
      url: 'https://uvd.yupoo.com/720p/minkang/13591294.mp4',
      thumb: 'https://uvd.yupoo.com/minkang/13591294_thumb.jpg',
    }]);
  });

  it('returns nothing for an album of photos only', () => {
    expect(videosOf('<img data-type="photo" data-src="https://photo.yupoo.com/a/b/medium.jpg">')).toEqual([]);
  });

  it('skips a video that is not playable yet', () => {
    expect(videosOf('<img data-type="video" data-path="/s/1.mov" data-videoformats="transcoding">')).toEqual([]);
  });

  it('keeps gallery order across several videos', () => {
    const html = '<img data-type="video" data-path="/s/2.mp4" data-videoformats="v720p">'
      + '<img data-type="video" data-path="/s/1.mp4" data-videoformats="v720p">';
    expect(videosOf(html).map((v) => v.url)).toEqual([
      'https://uvd.yupoo.com/720p/s/2.mp4', 'https://uvd.yupoo.com/720p/s/1.mp4',
    ]);
  });
});

describe('parseVideos / isYupooVideoUrl', () => {
  it('round-trips the stored column and drops anything that is not a Yupoo video', () => {
    const json = JSON.stringify([
      { url: 'https://uvd.yupoo.com/720p/s/1.mp4', thumb: 't' },
      { url: 'https://evil.example/x.mp4' },
      'junk',
    ]);
    expect(parseVideos(json)).toEqual([{ url: 'https://uvd.yupoo.com/720p/s/1.mp4', thumb: 't' }]);
    expect(parseVideos(null)).toEqual([]);
    expect(parseVideos('{not json')).toEqual([]);
  });

  it('accepts only uvd.yupoo.com mp4 files as a post clip', () => {
    expect(isYupooVideoUrl('https://uvd.yupoo.com/720p/s/1.mp4')).toBe(true);
    expect(isYupooVideoUrl('https://uvd.yupoo.com/720p/s/1.mp4?x=1')).toBe(false);
    expect(isYupooVideoUrl('https://evil.example/s/1.mp4')).toBe(false);
    expect(isYupooVideoUrl(undefined)).toBe(false);
  });
});
