import { mergeAlbum, parseAlbumVideos, splitSelection } from './album-videos';

const V1 = 'https://uvd.yupoo.com/720p/s/1.mp4';
const V2 = 'https://uvd.yupoo.com/720p/s/2.mp4';

describe('splitSelection', () => {
  it('keeps each video at its place in the owner\'s order', () => {
    expect(splitSelection(['p1', V1, 'p2', V2], [V1, V2])).toEqual({
      photos: ['p1', 'p2'],
      videos: [{ url: V1, at: 1 }, { url: V2, at: 3 }],
    });
  });

  it('picks no video when none was selected — nothing by default', () => {
    expect(splitSelection(['p1', 'p2'], [V1, V2])).toEqual({ photos: ['p1', 'p2'], videos: [] });
    expect(splitSelection(undefined, [V1])).toEqual({ photos: [], videos: [] });
  });

  it('treats a URL that is not one of the product\'s videos as a photo pick', () => {
    expect(splitSelection(['https://evil.example/x.mp4'], [V1]).videos).toEqual([]);
  });

  it('ignores repeats and blanks', () => {
    expect(splitSelection([V1, V1, '', 'p1'], [V1])).toEqual({ photos: ['p1'], videos: [{ url: V1, at: 0 }] });
  });
});

describe('mergeAlbum', () => {
  const asVideo = (u: string) => `video:${u}`;

  it('rebuilds the owner\'s order', () => {
    const { photos, videos } = splitSelection([V1, 'p1', 'p2', V2], [V1, V2]);
    expect(mergeAlbum(photos, videos, asVideo)).toEqual([`video:${V1}`, 'p1', 'p2', `video:${V2}`]);
  });

  it('appends a video whose position is past the end (photos became fewer collage sheets)', () => {
    expect(mergeAlbum(['sheet1'], [{ url: V1, at: 7 }], asVideo)).toEqual(['sheet1', `video:${V1}`]);
  });

  it('caps the album at ten items', () => {
    const photos = Array.from({ length: 10 }, (_, i) => `p${i}`);
    const merged = mergeAlbum(photos, [{ url: V1, at: 0 }], asVideo);
    expect(merged).toHaveLength(10);
    expect(merged[0]).toBe(`video:${V1}`);
  });

  it('works with videos only', () => {
    expect(mergeAlbum([], [{ url: V2, at: 1 }, { url: V1, at: 0 }], asVideo)).toEqual([`video:${V1}`, `video:${V2}`]);
  });
});

describe('parseAlbumVideos', () => {
  it('round-trips and drops junk', () => {
    expect(parseAlbumVideos(JSON.stringify([{ url: V1, at: 2 }, { url: 3 }, 'x']))).toEqual([{ url: V1, at: 2 }]);
    expect(parseAlbumVideos(null)).toEqual([]);
    expect(parseAlbumVideos('nope')).toEqual([]);
  });
});
