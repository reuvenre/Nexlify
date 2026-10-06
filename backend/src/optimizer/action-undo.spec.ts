import { ActionRow, actionLabel, isUndoable, undoPlan } from './action-undo';

const row = (over: Partial<ActionRow>): ActionRow => ({
  id: 'a1', kind: 'keywords', target_id: 'c1', target_label: 'טקטי בקליק',
  before: null, after: null, reason: null, until_at: null, undone_at: null,
  ...over,
});

const kw = (keywords: string[], retired: string[] = []) => JSON.stringify({ keywords, retired });

describe('actionLabel — what the engine did, in the owner\'s words', () => {
  it('names added and removed keywords together on one line', () => {
    const label = actionLabel(row({
      before: kw(['שעון חכם', 'מגבות']),
      after: kw(['מגבות', 'מטחנת קפה']),
    }));
    expect(label).toBe('[טקטי בקליק] הוספתי "מטחנת קפה", הוצאתי "שעון חכם"');
  });

  it('sees a DOUBLED keyword — the list is the same, one entry just weighs more', () => {
    // The boost is a second copy in the rotation. Comparing sets alone reports "no change",
    // which is exactly the change the owner most wants to know about.
    const label = actionLabel(row({
      before: kw(['מגבות', 'שעון']),
      after: kw(['מגבות', 'שעון', 'מגבות']),
    }));
    expect(label).toBe('[טקטי בקליק] הכפלתי "מגבות"');
  });

  it('sees a boost being collapsed back to one slot', () => {
    const label = actionLabel(row({
      before: kw(['מגבות', 'מגבות', 'שעון']),
      after: kw(['מגבות', 'שעון']),
    }));
    expect(label).toContain('החזרתי למינון רגיל "מגבות"');
  });

  it('names the keyword itself for a pause — its label is the word, not the group', () => {
    const label = actionLabel(row({ kind: 'keyword_pause', target_label: 'רחפן' }));
    expect(label).toBe('הפסקתי את "רחפן" ל-24 שעות — הפסיקה להביא קליקים');
  });

  it('says a resumed campaign was resumed, not "status changed"', () => {
    expect(actionLabel(row({ kind: 'campaign_status', before: 'paused', after: 'active' })))
      .toBe('[טקטי בקליק] חידשתי את הטייס — הוא הפסיק לפרסם');
  });

  it('explains what turning learning on will do', () => {
    expect(actionLabel(row({ kind: 'learn_from_orders', before: 'false', after: 'true' })))
      .toContain('הדלקתי "למידה ממכירות"');
  });

  it('falls back to the recorded reason for a kind it does not know', () => {
    expect(actionLabel(row({ kind: 'something_new', reason: 'סיבה מדודה' })))
      .toBe('[טקטי בקליק] סיבה מדודה');
  });
});

describe('undoPlan — one tap puts it back', () => {
  it('restores the whole keyword list, not a diff', () => {
    // A diff can half-apply if the list moved on since; the desired end state cannot.
    const plan = undoPlan(row({
      before: kw(['שעון חכם', 'מגבות'], ['ישן']),
      after: kw(['מגבות', 'מטחנת קפה']),
    }));
    expect(plan).toEqual({
      kind: 'keywords', campaignId: 'c1',
      keywords: ['שעון חכם', 'מגבות'], retired: ['ישן'],
    });
  });

  it('puts posts_per_run back to the number it was', () => {
    expect(undoPlan(row({ kind: 'posts_per_run', before: '3', after: '4' })))
      .toEqual({ kind: 'posts_per_run', campaignId: 'c1', value: 3 });
  });

  it('ends a keyword pause early — that IS its inverse', () => {
    expect(undoPlan(row({ kind: 'keyword_pause', target_label: 'רחפן' })))
      .toEqual({ kind: 'keyword_pause', campaignId: 'c1', keyword: 'רחפן' });
  });

  it('re-pauses a campaign the engine resumed', () => {
    expect(undoPlan(row({ kind: 'campaign_status', before: 'paused', after: 'active' })))
      .toEqual({ kind: 'campaign_status', campaignId: 'c1', status: 'paused' });
  });

  it('turns a setting back off — and reads "false" as false, not as a truthy string', () => {
    expect(undoPlan(row({ kind: 'learn_from_orders', before: 'false', after: 'true' })))
      .toEqual({ kind: 'learn_from_orders', campaignId: 'c1', value: false });
  });

  it('un-mutes a product by naming it — the standing row IS the mute', () => {
    expect(undoPlan(row({ kind: 'product_mute', target_id: '1005006', target_label: 'מטחנת קפה' })))
      .toEqual({ kind: 'product_mute', productId: '1005006' });
  });

  it('refuses to undo twice — a second tap must not re-apply an old state', () => {
    const already = row({ before: kw(['א']), after: kw(['ב']), undone_at: new Date() });
    expect(undoPlan(already)).toBeNull();
    expect(isUndoable(already)).toBe(false);
  });

  it('offers no button for a row that recorded an observation, not a change', () => {
    // golden_hours re-derives a cache; there is no previous state held to restore.
    expect(undoPlan(row({ kind: 'golden_hours', before: '[9,20]', after: '[12,21]' }))).toBeNull();
  });

  it('refuses a row whose stored state is corrupt instead of restoring garbage', () => {
    expect(undoPlan(row({ before: 'not json', after: kw(['ב']) }))).toBeNull();
    expect(undoPlan(row({ kind: 'posts_per_run', before: 'abc' }))).toBeNull();
    expect(undoPlan(row({ target_id: null, before: kw(['א']) }))).toBeNull();
  });
});

describe('seasonal_keywords — a change the owner approved from the manager', () => {
  const row = (over: Record<string, any> = {}) => ({
    id: 'a1', kind: 'seasonal_keywords', target_id: 'c1', target_label: 'Pinterest',
    before: 'false', after: 'true', reason: null, until_at: null, undone_at: null, ...over,
  });

  it('is named and undone back to the previous state', () => {
    expect(actionLabel(row())).toBe('[Pinterest] הדלקתי מילים עונתיות');
    expect(undoPlan(row())).toEqual({ kind: 'seasonal_keywords', campaignId: 'c1', value: false });
    expect(undoPlan(row({ undone_at: new Date() }))).toBeNull();
  });
});

describe('copy angle changes', () => {
  const { actionLabel, undoPlan } = require('./action-undo');
  const row = (before: any[], after: any[]) => ({ id: 'a', kind: 'copy_angles', target_id: 'c1', target_label: 'טקטי', before: JSON.stringify(before), after: JSON.stringify(after), reason: 'r', undone_at: null });
  const a = { id: 'c-1', label: 'מותאם: פתח במחיר', hint: 'h' };

  it('names the angle added or removed, and undo restores the list before', () => {
    expect(actionLabel(row([], [a]))).toBe('[טקטי] הוספתי זווית כתיבה: מותאם: פתח במחיר');
    expect(actionLabel(row([a], []))).toBe('[טקטי] הפסקתי זווית כתיבה: מותאם: פתח במחיר');
    expect(undoPlan(row([], [a]))).toEqual({ kind: 'copy_angles', campaignId: 'c1', angles: [] });
  });
});
