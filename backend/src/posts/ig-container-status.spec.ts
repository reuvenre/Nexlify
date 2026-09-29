import { notReadyVerdict, publishTimeoutVerdict } from './ig-container-status';

describe('publishTimeoutVerdict', () => {
  it('accepts a timed-out publish that actually went live', () => {
    // The whole point: a publish timeout is ambiguous to US, not to Instagram. The
    // container says PUBLISHED, so the send succeeded and must not be reported as failed.
    expect(publishTimeoutVerdict('PUBLISHED')).toBe('published');
    expect(publishTimeoutVerdict('published')).toBe('published');
  });

  it('allows another attempt while the container is merely ready', () => {
    // FINISHED means processed and NOT published — publishing again cannot duplicate.
    expect(publishTimeoutVerdict('FINISHED')).toBe('retry');
    expect(publishTimeoutVerdict('IN_PROGRESS')).toBe('retry');
  });

  it('invents no outcome when the container cannot answer', () => {
    // A failed status check must fail the send loudly rather than guess in either
    // direction — a wrong "published" hides a missing post, a wrong "retry" duplicates one.
    expect(publishTimeoutVerdict(undefined)).toBe('unknown');
    expect(publishTimeoutVerdict('')).toBe('unknown');
    expect(publishTimeoutVerdict('ERROR')).toBe('unknown');
    expect(publishTimeoutVerdict('EXPIRED')).toBe('unknown');
  });
});

describe('after media_publish answers #9007 "Media ID is not available"', () => {
  it('treats a container that already went live as the success it was', () => {
    expect(notReadyVerdict('PUBLISHED')).toBe('published');
  });

  it.each(['FINISHED', 'IN_PROGRESS', undefined, null, ''])('keeps waiting on %p', (code) => {
    expect(notReadyVerdict(code as any)).toBe('wait');
  });

  it('stops at once on a rejected image — waiting cannot fix it', () => {
    expect(notReadyVerdict('ERROR')).toBe('rejected');
  });

  it('stops at once on an expired container — only a fresh send can publish', () => {
    expect(notReadyVerdict('expired')).toBe('expired');
  });
});
