import { firstLink, markdownLinksToHtml } from './post-link';

describe('firstLink — what a hand-written post is actually selling', () => {
  it('finds the link at the end of a holiday promo', () => {
    const body = [
      '🍎 שנה טובה — עמוד החגים של אלי אקספרס נפתח',
      '',
      '👇 להיכנס ולבחור',
      'https://s.click.aliexpress.com/e/_c3WHSgdt',
    ].join('\n');
    expect(firstLink(body)).toBe('https://s.click.aliexpress.com/e/_c3WHSgdt');
  });

  it('takes the FIRST link — that is the call to action', () => {
    const body = 'https://a.example/one ועוד אחד https://b.example/two';
    expect(firstLink(body)).toBe('https://a.example/one');
  });

  it('does not swallow the punctuation that ended the sentence', () => {
    expect(firstLink('קנו כאן: https://x.example/deal.')).toBe('https://x.example/deal');
    expect(firstLink('כאן https://x.example/deal, ומהר')).toBe('https://x.example/deal');
    expect(firstLink('"https://x.example/deal"')).toBe('https://x.example/deal');
  });

  it('keeps a bracket the URL itself opened', () => {
    expect(firstLink('(ראו https://x.example/a(b) כאן)')).toBe('https://x.example/a(b)');
    expect(firstLink('(ראו https://x.example/a)')).toBe('https://x.example/a');
  });

  it('stops at the quote of an HTML anchor', () => {
    expect(firstLink('<a href="https://x.example/deal">לחצו</a>')).toBe('https://x.example/deal');
  });

  it('returns nothing when the post carries no link at all', () => {
    expect(firstLink('שנה טובה לכולם 🍎')).toBeNull();
    expect(firstLink('')).toBeNull();
    expect(firstLink(null)).toBeNull();
    expect(firstLink(undefined)).toBeNull();
  });

  it('ignores a bare domain — a redirect needs a real destination', () => {
    expect(firstLink('כנסו ל-aliexpress.com')).toBeNull();
  });
});

describe('markdownLinksToHtml', () => {
  it('turns [text](url) into an anchor that shows only the text', () => {
    const { html, links } = markdownLinksToHtml('👈 להתחלה [לחצו כאן](https://t.me/NexlifyBot?start=post)\nעוד שורה');
    expect(html).toBe('👈 להתחלה <a href="https://t.me/NexlifyBot?start=post">לחצו כאן</a>\nעוד שורה');
    expect(links).toEqual(['https://t.me/NexlifyBot?start=post']);
  });

  it('escapes the link text and leaves bodies without the syntax untouched', () => {
    expect(markdownLinksToHtml('[a<b>](https://x.y/z)').html).toBe('<a href="https://x.y/z">a&lt;b&gt;</a>');
    expect(markdownLinksToHtml('plain https://x.y and [not a link]').links).toEqual([]);
  });
});
