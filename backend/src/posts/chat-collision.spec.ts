import { chatCollision, chatGapMinutes, postChats } from './chat-collision';

describe('chatGapMinutes', () => {
  it('half the interval, at most 15 minutes', () => {
    expect(chatGapMinutes(60)).toBe(15);
    expect(chatGapMinutes(20)).toBe(10);
    expect(chatGapMinutes(240)).toBe(15);
    expect(chatGapMinutes(null)).toBe(15);
    expect(chatGapMinutes(1)).toBe(1);
  });
});

describe('postChats', () => {
  it('a group post lands in its groups, normalised', () => {
    expect(postChats(['1234567890', '-1009876543210'], '-100555')).toEqual(['-1001234567890', '-1009876543210']);
  });

  it('a post with no group lands in the default channel', () => {
    expect(postChats([undefined], '1234567890')).toEqual(['-1001234567890']);
    expect(postChats([], null)).toEqual([]);
  });
});

describe('chatCollision', () => {
  const now = new Date('2026-10-09T06:00:30Z');
  const tactical = '-1001111111111';

  it('the queue drip and the campaign release in the same minute: the second is held', () => {
    const recent = [{ chats: [tactical], at: new Date('2026-10-09T06:00:02Z') }];
    expect(chatCollision([tactical], recent, now, 15)).toEqual(new Date('2026-10-09T06:00:02Z'));
  });

  it('a default-channel post that is also a saved group meets the group post', () => {
    const recent = [{ chats: postChats([undefined], '1111111111'), at: new Date('2026-10-09T06:00:05Z') }];
    expect(chatCollision(postChats(['-1001111111111'], null), recent, now, 15)).not.toBeNull();
  });

  it('a multi-group post meets a post to any of its groups', () => {
    const recent = [{ chats: ['-1002222222222', tactical], at: new Date('2026-10-09T05:58:00Z') }];
    expect(chatCollision([tactical], recent, now, 15)).not.toBeNull();
  });

  it('lets the post go when the last one is older than the gap, or in another chat', () => {
    expect(chatCollision([tactical], [{ chats: [tactical], at: new Date('2026-10-09T05:00:31Z') }], now, 15)).toBeNull();
    expect(chatCollision([tactical], [{ chats: ['-1002222222222'], at: new Date('2026-10-09T06:00:00Z') }], now, 15)).toBeNull();
    expect(chatCollision([tactical], [], now, 15)).toBeNull();
  });

  it('reports the latest of several', () => {
    const recent = [
      { chats: [tactical], at: new Date('2026-10-09T05:50:00Z') },
      { chats: [tactical], at: new Date('2026-10-09T05:55:00Z') },
    ];
    expect(chatCollision([tactical], recent, now, 15)).toEqual(new Date('2026-10-09T05:55:00Z'));
  });
});
