import {
  followButton, isFinal, isNewStage, isTrackHelp, israelTime, parcelCard, parseParcelCallback, parseTrackingNumber,
  readTrackInfo, statusText, trackingLink,
} from './parcel-tracking';

describe('parseTrackingNumber', () => {
  it.each([
    ['LP00123456789012', 'LP00123456789012'],
    ['rb123456789cn', 'RB123456789CN'],
    ['  UA123456789SG ', 'UA123456789SG'],
    ['/track LP00123456789012', 'LP00123456789012'],
    ['/track@DealsBot rr123456789cn', 'RR123456789CN'],
    ['מעקב YT2312345678901234', 'YT2312345678901234'],
    ['מעקב חבילה CNIL-12345678', 'CNIL12345678'],
  ])('%s → %s', (text, number) => {
    expect(parseTrackingNumber(text)).toBe(number);
  });

  it.each([
    'cz p10c', 'rtx 4090', 'פנס טקטי', 'XT-5', 'x300u', '1005006123456789', // an AliExpress product id has no letters
    'https://s.click.aliexpress.com/e/_c3yh4uXV', 'ABCDEFGHIJKL', '/track', '/track abc',
  ])('leaves «%s» as a search', (text) => {
    expect(parseTrackingNumber(text)).toBeNull();
  });
});

it('isTrackHelp: the bare commands', () => {
  for (const t of ['/track', '/parcels', 'מעקב', 'מעקב חבילה', 'איפה החבילה שלי?']) expect(isTrackHelp(t)).toBe(true);
  expect(isTrackHelp('מעקב LP00123456789012')).toBe(false);
});

describe('17TRACK track_info', () => {
  const info = {
    latest_status: { status: 'InTransit', sub_status: 'InTransit_Arrival' },
    latest_event: { time_utc: '2026-10-07T11:05:00Z', description: 'Arrived at <Ben Gurion>', location: 'TEL AVIV, IL' },
  };

  it('reads the stage and the last event', () => {
    expect(readTrackInfo(info)).toEqual({
      status: 'InTransit', subStatus: 'InTransit_Arrival', eventTime: '2026-10-07T11:05:00Z',
      eventText: 'Arrived at <Ben Gurion>', eventLocation: 'TEL AVIV, IL',
    });
    expect(readTrackInfo(null).status).toBeNull();
  });

  it('names the stage in Hebrew, sub-status first', () => {
    expect(statusText('InTransit', 'InTransit_Arrival')).toBe('🇮🇱 החבילה הגיעה לישראל');
    expect(statusText('InTransit', 'InTransit_Other')).toBe('🚛 החבילה בדרך');
    expect(statusText('Delivered', 'Delivered_Other')).toBe('✅ החבילה נמסרה');
    expect(statusText(null, null)).toMatch(/עדיין אין מידע/);
  });

  it('a card escapes the carrier text and links the full page', () => {
    const card = parcelCard('RB123456789CN', readTrackInfo(info), { update: true });
    expect(card).toContain('📬 עדכון משלוח <code>RB123456789CN</code>');
    expect(card).toContain('🇮🇱 החבילה הגיעה לישראל');
    expect(card).toContain('7/10 14:05 · Arrived at &lt;Ben Gurion&gt; (TEL AVIV, IL)');
    expect(card).toContain(`href="${trackingLink('RB123456789CN')}"`);
  });

  it('a card with no stage yet is just the link', () => {
    expect(parcelCard('RB123456789CN', null).split('\n')).toHaveLength(2);
  });
});

describe('what the reader is told about', () => {
  const s = (status: string, subStatus: string) => ({ status, subStatus, eventTime: null, eventText: null, eventLocation: null });

  it('a new stage, not another scan at the same stage', () => {
    expect(isNewStage({ status: null, subStatus: null }, s('InTransit', 'InTransit_PickedUp'))).toBe(true);
    expect(isNewStage({ status: 'InTransit', subStatus: 'InTransit_PickedUp' }, s('InTransit', 'InTransit_Departure'))).toBe(true);
    expect(isNewStage({ status: 'InTransit', subStatus: 'InTransit_Other' }, s('InTransit', 'InTransit_Other'))).toBe(false);
    expect(isNewStage({ status: null, subStatus: null }, s('NotFound', 'NotFound_Other'))).toBe(false);
  });

  it('ends on delivery or a finished failure', () => {
    expect(isFinal('Delivered', 'Delivered_Other')).toBe(true);
    expect(isFinal('Exception', 'Exception_Returned')).toBe(true);
    expect(isFinal('Exception', 'Exception_Delayed')).toBe(false);
    expect(isFinal('AvailableForPickup', null)).toBe(false);
  });
});

it('buttons round-trip and fit Telegram callback data', () => {
  const b = followButton('LP00123456789012');
  expect(parseParcelCallback(b.callback_data)).toEqual({ action: 'follow', number: 'LP00123456789012' });
  expect(parseParcelCallback(followButton('LP00123456789012', true).callback_data)?.action).toBe('stop');
  expect(parseParcelCallback('pw:1005006123456789')).toBeNull();
  expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
});

it('israelTime', () => {
  expect(israelTime('2026-01-15T10:00:00Z')).toBe('15/1 12:00');
  expect(israelTime('nonsense')).toBe('');
});
