import { uncountedReason } from './earnings.service';

const row = (status: string, paid: string | null) => ({
  order_id: '1', status, paid_date: paid ? new Date(paid) : null, order_date: null,
});

describe('why a portal row is not counted', () => {
  it('counts an estimated row paid on the same Pacific day', () => {
    // 2026-10-05 23:30 Pacific = 2026-10-06T06:30Z.
    expect(uncountedReason({ paid_at: '2026-10-05 23:30:00', status: 'Payment Completed' },
      row('estimated', '2026-10-06T06:30:00Z'))).toBeNull();
  });

  it('names a row cancelled here but live in the portal', () => {
    expect(uncountedReason({ paid_at: '2026-10-05 10:00:00', status: 'Payment Completed' },
      row('cancelled', '2026-10-05T17:00:00Z'))).toContain('בוטלה במערכת');
  });

  it('says when the portal cancelled it too', () => {
    expect(uncountedReason({ paid_at: '2026-10-05 10:00:00', status: 'Invalid' },
      row('cancelled', '2026-10-05T17:00:00Z'))).toContain('מבוטלת גם בפורטל');
  });

  it('names a stored payment day that is not the portal\'s', () => {
    // Stored 15 h early by the old GMT+8 reading: Oct 1 08:00 Pacific → Sep 30.
    const r = uncountedReason({ paid_at: '2026-10-01 08:00:00', status: 'Payment Completed' },
      row('estimated', '2026-09-30T00:00:00Z'));
    expect(r).toContain('2026-10-01');
    expect(r).toContain('2026-09-29');
  });

  it('stays quiet when the file carries no payment time', () => {
    expect(uncountedReason({ paid_at: '', status: '' }, row('estimated', '2026-09-30T00:00:00Z'))).toBeNull();
  });
});
