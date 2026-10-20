import { attemptDue, jerusalemNow, missedReportVerdict } from './scout-delivery';
import { sourcesLine } from './commission-scout';

describe('the morning commission report', () => {
  it('tries from 08:20 to 11:40, Israel time', () => {
    expect(attemptDue(8, 0)).toBe(false);
    expect(attemptDue(8, 20)).toBe(true);
    expect(attemptDue(10, 0)).toBe(true);
    expect(attemptDue(11, 40)).toBe(true);
    expect(attemptDue(12, 0)).toBe(false);
  });

  it('reads the Israel wall clock, across DST', () => {
    // 05:20 UTC in October (IDT, +3) and 06:20 UTC in December (IST, +2) are both 08:20 in Israel
    expect(jerusalemNow(new Date('2026-10-20T05:20:00Z'))).toEqual({ day: '2026-10-20', hour: 8, minute: 20 });
    expect(jerusalemNow(new Date('2026-12-01T06:20:00Z'))).toEqual({ day: '2026-12-01', hour: 8, minute: 20 });
    // 22:30 UTC is already the next day in Israel
    expect(jerusalemNow(new Date('2026-10-20T22:30:00Z')).day).toBe('2026-10-21');
  });

  it('says nothing while the report is still due, or once it went out', () => {
    expect(missedReportVerdict({ hour: 11, delivered: false, failure: null })).toBeNull();
    expect(missedReportVerdict({ hour: 15, delivered: true, failure: null })).toBeNull();
  });

  it('names the last failure once the window closed without a report', () => {
    const v = missedReportVerdict({ hour: 12, delivered: false, failure: { at: '11:40', reason: 'socket hang up', attempts: 10 } });
    expect(v?.detail).toContain('10 ניסיונות');
    expect(v?.detail).toContain('socket hang up');
    expect(v?.action).toBeUndefined(); // a network error is not his to fix
  });

  it('says the server slept when no attempt ran at all', () => {
    expect(missedReportVerdict({ hour: 13, delivered: false, failure: null })?.detail).toContain('השרת');
  });

  it('asks him to check the keys only when they were refused', () => {
    const v = missedReportVerdict({ hour: 12, delivered: false, failure: { at: '09:00', reason: 'Invalid app_key', attempts: 1 } });
    expect(v?.action).toContain('מפתחות AliExpress');
  });
});

describe('what each source gave', () => {
  it('lists every source with its products at the bar and its failures', () => {
    const line = sourcesLine([
      { group: 'promo', calls: 4, read: 200, at_bar: 40, errors: 0 },
      { group: 'keywords', calls: 10, read: 300, at_bar: 12, errors: 2 },
      { group: 'categories', calls: 3, read: 0, at_bar: 0, errors: 3 },
    ], 12);
    expect(line).toContain('רשימות המבצעים: 40');
    expect(line).toContain('מילות המפתח שלך: 12 (2 חיפושים נכשלו)');
    expect(line).toContain('הקטגוריות: 0 (כל החיפושים נכשלו)');
  });
});
