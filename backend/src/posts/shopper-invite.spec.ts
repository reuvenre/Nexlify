import { SHOPPER_INVITE_TEXT, SHOPPER_INVITE_VARIANTS, withShopperInvite } from './shopper-invite';

const POST = '🔥 <b>חגורה טקטית</b>\n\n<a href="https://x.app/r/AbC?s=tg">🛒 לרכישה — לחצו כאן 🛒</a>';

describe('withShopperInvite', () => {
  it('appends the bot link as the last line of a Hebrew post', () => {
    const out = withShopperInvite(POST, 'NexlifyBot', 1024);
    expect(out.endsWith(`<a href="https://t.me/NexlifyBot?start=post">${SHOPPER_INVITE_TEXT}</a>`)).toBe(true);
    expect(out.startsWith(POST)).toBe(true);
  });

  it('leaves English posts, missing or invalid usernames, and re-sends alone', () => {
    expect(withShopperInvite('Great lamp', 'NexlifyBot', 1024)).toBe('Great lamp');
    expect(withShopperInvite(POST, null, 1024)).toBe(POST);
    expect(withShopperInvite(POST, 'bad name"><script>', 1024)).toBe(POST);
    const once = withShopperInvite(POST, 'NexlifyBot', 1024);
    expect(withShopperInvite(once, 'NexlifyBot', 1024)).toBe(once);
  });

  it('shortens the line for a tight caption instead of dropping it', () => {
    const fullLen = withShopperInvite(POST, 'NexlifyBot', 1024).length;
    // Room for the middle wording but not the full one.
    const pad = 1024 - fullLen + 10;
    const tight = `${POST}${'א'.repeat(pad)}`;
    const out = withShopperInvite(tight, 'NexlifyBot', 1024);
    expect(out.length).toBeLessThanOrEqual(1024);
    expect(out.endsWith(`${SHOPPER_INVITE_VARIANTS[1]}</a>`)).toBe(true);
  });

  it('falls back to the shortest wording, and leaves the caption alone only when nothing fits', () => {
    const shortest = `<a href="https://t.me/NexlifyBot?start=post">${SHOPPER_INVITE_VARIANTS[2]}</a>`;
    const almost = `${POST}${'א'.repeat(1024 - POST.length - shortest.length - 2)}`;
    expect(withShopperInvite(almost, 'NexlifyBot', 1024).endsWith(`${SHOPPER_INVITE_VARIANTS[2]}</a>`)).toBe(true);
    const full = `${POST}${'א'.repeat(1024 - POST.length - 5)}`;
    expect(withShopperInvite(full, 'NexlifyBot', 1024)).toBe(full);
  });

  it('still adds it to a caption that already overflows (it goes out as a text message)', () => {
    const long = `${POST}${'א'.repeat(1100)}`;
    expect(withShopperInvite(long, 'NexlifyBot', 1024)).not.toBe(long);
  });
});
