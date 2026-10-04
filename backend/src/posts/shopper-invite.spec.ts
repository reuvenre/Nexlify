import { SHOPPER_INVITE_TEXT, withShopperInvite } from './shopper-invite';

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

  it('never pushes a fitting caption over the photo limit', () => {
    const near = `${POST}${'א'.repeat(1024 - POST.length - 10)}`;
    expect(withShopperInvite(near, 'NexlifyBot', 1024)).toBe(near);
  });

  it('still adds it to a caption that already overflows (it goes out as a text message)', () => {
    const long = `${POST}${'א'.repeat(1100)}`;
    expect(withShopperInvite(long, 'NexlifyBot', 1024)).not.toBe(long);
  });
});
