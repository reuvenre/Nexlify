import {
  buyLink, channelPostRef, channelPostUrl, forwardedChannelRef, isOwnChannel, messageLinks, messageText,
} from './channel-capture';
import { channelHits, shopperCaption } from './shopper';

const CAPTION = '🔧 ידיות הסתערות לשדרוג הנשק 🔧\n➡️ להזמנה: https://s.click.aliexpress.com/e/_c3yh4uXV\n🛒 לרכישה\n🔎 Nexlify Deals Bot';

describe('reading a channel post', () => {
  it('takes a photo post\'s caption and finds links hidden behind text and written out', () => {
    const msg = {
      caption: CAPTION,
      caption_entities: [
        { type: 'url', offset: CAPTION.indexOf('https'), length: 'https://s.click.aliexpress.com/e/_c3yh4uXV'.length },
        { type: 'text_link', offset: CAPTION.indexOf('🛒'), length: 9, url: 'https://nexlify.app/r/AbC' },
        { type: 'text_link', offset: CAPTION.indexOf('🔎'), length: 10, url: 'https://t.me/nexlify_deals_bot?start=post' },
      ],
    };
    expect(messageText(msg)).toBe(CAPTION);
    expect(messageLinks(msg)).toEqual([
      'https://s.click.aliexpress.com/e/_c3yh4uXV', 'https://nexlify.app/r/AbC', 'https://t.me/nexlify_deals_bot?start=post',
    ]);
    expect(buyLink(messageLinks(msg))).toBe('https://s.click.aliexpress.com/e/_c3yh4uXV');
  });

  it('never buys through a Telegram link, and finds a written-out link without entities', () => {
    expect(buyLink(['https://t.me/x/1', 'https://telegram.me/y'])).toBeNull();
    expect(messageLinks({ text: 'לרכישה: https://s.flylinking.com/g-JVECL903UO.' })).toEqual(['https://s.flylinking.com/g-JVECL903UO']);
  });

  it('knows a channel post and a forwarded one — new and old Bot API shapes — and nothing else', () => {
    expect(channelPostRef({ chat: { id: -1001234, type: 'channel', username: 'TactiBeClick' }, message_id: 4926, date: 1700000000 }))
      .toEqual({ chatId: '-1001234', username: 'TactiBeClick', messageId: 4926, date: 1700000000 });
    expect(channelPostRef({ chat: { id: 5, type: 'private' }, message_id: 1 })).toBeNull();
    expect(forwardedChannelRef({ forward_origin: { type: 'channel', chat: { id: -1001234, username: 'TactiBeClick' }, message_id: 4926, date: 1 } }))
      .toEqual({ chatId: '-1001234', username: 'TactiBeClick', messageId: 4926, date: 1 });
    expect(forwardedChannelRef({ forward_from_chat: { id: -1009, type: 'channel' }, forward_from_message_id: 7, forward_date: 2 }))
      .toEqual({ chatId: '-1009', username: null, messageId: 7, date: 2 });
    expect(forwardedChannelRef({ forward_origin: { type: 'user', sender_user: { id: 1 } } })).toBeNull();
    expect(forwardedChannelRef({ text: 'hi' })).toBeNull();
  });

  it('matches the owner\'s saved channels by id or @username, case-insensitively', () => {
    expect(isOwnChannel({ chatId: '-1001234', username: 'TactiBeClick' }, ['@tacticlick', '@TACTIBECLICK'])).toBe(true);
    expect(isOwnChannel({ chatId: '-1001234', username: null }, ['-1001234'])).toBe(true);
    expect(isOwnChannel({ chatId: '-1005555', username: 'competitor' }, ['-1001234', '@TactiBeClick'])).toBe(false);
  });

  it('addresses the post publicly by username, or members-only by id', () => {
    expect(channelPostUrl('TactiBeClick', '-1001234', 4926)).toBe('https://t.me/TactiBeClick/4926');
    expect(channelPostUrl(null, '-1001234', 4926)).toBe('https://t.me/c/1234/4926');
    expect(channelPostUrl(null, '12', 1)).toBeNull();
  });
});

describe('a result from the channel itself', () => {
  it('needs no photo of its own: it points to the post, and keeps the hidden-product instructions', () => {
    const [hit] = channelHits([{
      id: 'm1', product_id: 'tg:-1001234:4926', product_title: '', product_image: '', price_ils: 0,
      generated_text: `${CAPTION}\n⚠️המוצר הוא מוצר מוסתר\nיש לבחור בקוד XT-5`,
      affiliate_url: 'https://s.click.aliexpress.com/e/_c3yh4uXV', post_url: 'https://t.me/TactiBeClick/4926',
    }], 2, ['ידי', 'הסתער']);
    expect(hit.product.image_url).toBeUndefined();
    const c = shopperCaption(hit.product, 1, 'https://nexlify.app/r/X');
    expect(c).toContain('🔧 ידיות הסתערות לשדרוג הנשק 🔧');
    expect(c).toContain('🔑 בעמוד בחרו את הקוד: XT-5');
    expect(c).toContain('<a href="https://t.me/TactiBeClick/4926">📢 לפוסט המלא בערוץ</a>');
    expect(c.split('\n').pop()).toBe('<a href="https://nexlify.app/r/X">🛒 לרכישה — לחצו כאן 🛒</a>');
  });

  it('the same post found in both tables is shown once', () => {
    const base = { product_title: '', price_ils: 0, generated_text: '🔧 ידיות הסתערות לשדרוג הנשק 🔧', affiliate_url: 'https://x' };
    const hits = channelHits([
      { ...base, id: 'p', product_id: 'custom-1', product_image: 'https://img/a.jpg' },
      { ...base, id: 'm', product_id: 'tg:-100:1', product_image: '', post_url: 'https://t.me/c/1/1' },
    ]);
    expect(hits.map((h) => h.post.id)).toEqual(['p']);
  });
});
