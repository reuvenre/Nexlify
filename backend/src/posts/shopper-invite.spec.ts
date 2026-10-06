import { SHOPPER_INVITE_ANGLES, inviteAngleFor, withShopperInvite } from './shopper-invite';

const POST = '🔥 <b>חגורה טקטית</b>\n\n<a href="https://x.app/r/AbC?s=tg">🛒 לרכישה — לחצו כאן 🛒</a>';

/** A seed that lands on the given angle, so each test knows which wording to expect. */
function seedFor(id: string): string {
  for (let i = 0; i < 1000; i++) if (inviteAngleFor(`post-${i}`).id === id) return `post-${i}`;
  throw new Error(`no seed for ${id}`);
}

describe('withShopperInvite', () => {
  it('appends the bot link, with the angle\'s start code, as the last line of a Hebrew post', () => {
    const out = withShopperInvite(POST, 'NexlifyBot', 1024, seedFor('alert'));
    const alert = SHOPPER_INVITE_ANGLES.find((a) => a.id === 'alert')!;
    expect(out.endsWith(`<a href="https://t.me/NexlifyBot?start=inv_alert">${alert.forms[0]}</a>`)).toBe(true);
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
    const seed = seedFor('words');
    const words = SHOPPER_INVITE_ANGLES.find((a) => a.id === 'words')!;
    const fullLen = withShopperInvite(POST, 'NexlifyBot', 1024, seed).length;
    const tight = `${POST}${'א'.repeat(1024 - fullLen + 10)}`;
    const out = withShopperInvite(tight, 'NexlifyBot', 1024, seed);
    expect(out.length).toBeLessThanOrEqual(1024);
    expect(out.endsWith(`?start=inv_words">${words.forms[1]}</a>`)).toBe(true);
  });

  it('falls back to the bare bot name, and leaves the caption alone only when nothing fits', () => {
    const seed = seedFor('find');
    const shortest = '<a href="https://t.me/NexlifyBot?start=inv_find">🔎 Nexlify Deals Bot</a>';
    const almost = `${POST}${'א'.repeat(1024 - POST.length - shortest.length - 2)}`;
    expect(withShopperInvite(almost, 'NexlifyBot', 1024, seed).endsWith(shortest)).toBe(true);
    const full = `${POST}${'א'.repeat(1024 - POST.length - 5)}`;
    expect(withShopperInvite(full, 'NexlifyBot', 1024, seed)).toBe(full);
  });

  it('still adds it to a caption that already overflows (it goes out as a text message)', () => {
    const long = `${POST}${'א'.repeat(1100)}`;
    expect(withShopperInvite(long, 'NexlifyBot', 1024)).not.toBe(long);
  });
});

describe('inviteAngleFor', () => {
  it('is stable for a post, so a re-send keeps its line', () => {
    expect(inviteAngleFor('3f2a9c1e-5b7d')).toBe(inviteAngleFor('3f2a9c1e-5b7d'));
  });

  it('spreads posts about evenly across the angles — a fair test', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 3000; i++) {
      const id = inviteAngleFor(`${i.toString(16)}-a1b2-4c3d-9e8f-${(i * 7919).toString(16)}`).id;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    expect(counts.size).toBe(SHOPPER_INVITE_ANGLES.length);
    for (const n of counts.values()) expect(n).toBeGreaterThan(3000 / SHOPPER_INVITE_ANGLES.length * 0.8);
  });

  it('start codes are valid Telegram deep-link parameters', () => {
    for (const a of SHOPPER_INVITE_ANGLES) expect(`inv_${a.id}`).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });
});
