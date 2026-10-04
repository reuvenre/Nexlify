import { groupReadiness, readinessLine } from './group-readiness';

describe('groupReadiness', () => {
  it('reads the chat type and the bot\'s membership', () => {
    expect(groupReadiness('supergroup', 'administrator')).toBe('ready');
    expect(groupReadiness('group', 'creator')).toBe('ready');
    expect(groupReadiness('channel', 'administrator')).toBe('channel');
    expect(groupReadiness('supergroup', 'member')).toBe('not_admin');
    expect(groupReadiness('supergroup', 'left')).toBe('not_member');
    expect(groupReadiness(null, null)).toBe('unknown');
  });

  it('points channel members at the bot\'s private chat', () => {
    expect(readinessLine('דילים', 'channel', 'NexBot')).toContain('t.me/NexBot');
    expect(readinessLine('טקטי', 'ready')).toContain('/find עובד');
  });
});
