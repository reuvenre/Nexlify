import axios from 'axios';
import { albumIdOf, isHebrewQuery, normalizeCatalogQuery } from './catalog-search';
import { YupooService } from './yupoo.service';

jest.mock('axios');
const mockedGet = axios.get as jest.Mock;

/** The markup of a Yupoo search results page: album cards, then the pager. */
function searchPage(cards: Array<{ id: string; title: string; photo: string }>, nextPage: number | null): string {
  const a = cards.map((c) => `
    <a class="album__main" title="${c.title}" href="/albums/${c.id}?uid=1">
      <div class="album__imgwrap">
        <img alt="${c.title}" class="album__img" src="https://photo.yupoo.com/demo-store/${c.photo}/small.jpeg" loading="lazy">
      </div>
      <div class="text_overflow album__title">${c.title}</div>
    </a>`).join('');
  const next = nextPage
    ? `<a class="pagination__button " href="/search/album?uid&#x3D;1&amp;q&#x3D;x&amp;page&#x3D;${nextPage}" title="后一页">`
    : '<a class="pagination__button  pagination__disabled" title="后一页">';
  return `<html><body><div class="showindex__children">${a}</div>
    <div class="pagination__main"><a class="pagination__button  pagination__disabled" title="前一页"></a>${next}</a></div></body></html>`;
}

describe('catalog search helpers', () => {
  it('reads the album id out of an album URL', () => {
    expect(albumIdOf('https://demo-store.x.yupoo.com/albums/234277840?uid=1')).toBe('234277840');
    expect(albumIdOf('/albums/42')).toBe('42');
    expect(albumIdOf('https://demo-store.x.yupoo.com/categories/5')).toBeNull();
    expect(albumIdOf(null)).toBeNull();
  });

  it('cleans the query and refuses one too short to mean anything', () => {
    expect(normalizeCatalogQuery('  LUN1526   coach ')).toBe('LUN1526 coach');
    expect(normalizeCatalogQuery('a')).toBe('');
    expect(normalizeCatalogQuery('x'.repeat(200))).toHaveLength(80);
  });

  it('knows a Hebrew search, which supplier titles never answer', () => {
    expect(isHebrewQuery('ידית הסתערות')).toBe(true);
    expect(isHebrewQuery('LUN1526')).toBe(false);
  });
});

describe('YupooService.searchStore', () => {
  const svc = new YupooService();
  beforeEach(() => mockedGet.mockReset());

  it("asks the store's own search and parses the cards like a listing", async () => {
    mockedGet.mockResolvedValue({
      status: 200,
      data: searchPage([
        { id: '111', title: 'LUN1526 $56.99 COACH', photo: 'aaa' },
        { id: '222', title: 'MM-68SM2606-$45', photo: 'bbb' },
      ], 2),
    });
    const r = await svc.searchStore('https://demo-store.x.yupoo.com', 'LUN1526', { page: 1 });

    const url = new URL(mockedGet.mock.calls[0][0]);
    expect(url.host).toBe('demo-store.x.yupoo.com');
    expect(url.pathname).toBe('/search/album');
    expect(url.searchParams.get('q')).toBe('LUN1526');
    expect(url.searchParams.get('page')).toBe('1');

    expect(r.items).toEqual([
      { code: 'LUN1526', price: 56.99, description: 'COACH', album_url: 'https://demo-store.x.yupoo.com/albums/111?uid=1', thumb: 'https://photo.yupoo.com/demo-store/aaa/medium.jpeg' },
      { code: 'MM-68SM2606', price: 45, description: '', album_url: 'https://demo-store.x.yupoo.com/albums/222?uid=1', thumb: 'https://photo.yupoo.com/demo-store/bbb/medium.jpeg' },
    ]);
    expect(r.hasMore).toBe(true);
  });

  it('the last page has no next link', async () => {
    mockedGet.mockResolvedValue({ status: 200, data: searchPage([{ id: '1', title: 'ZT12681 $9', photo: 'c' }], null) });
    expect((await svc.searchStore('demo-store', 'ZT12681')).hasMore).toBe(false);
  });

  it('an empty query asks nothing', async () => {
    expect(await svc.searchStore('demo-store', '   ')).toEqual({ items: [], hasMore: false });
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('a password-gated store says so', async () => {
    mockedGet.mockResolvedValue({ status: 200, data: '<div class="indexlock__main"></div>' });
    await expect(svc.searchStore('demo-store', 'abc')).rejects.toThrow('סיסמה');
  });
});
