/**
 * Reading and reversing what the engine did.
 *
 * The owner gave the brain authority to change things on its own, which is only safe if
 * every change is (a) named in his language and (b) reversible by one tap. Both live here,
 * as pure functions over a manager_actions row, so the wording and the inverse can be
 * tested without a database.
 *
 * An action is undoable when its row carries enough to restore the previous state. A row
 * that recorded an observation rather than a mutation (golden_hours refreshes the CACHE;
 * the row is the record, not the change) has nothing to put back, and saying so beats
 * offering a button that quietly does nothing.
 */

/** The manager_actions columns this module reads. */
export interface ActionRow {
  id: string;
  kind: string;
  target_id: string | null;
  target_label: string | null;
  before: string | null;
  after: string | null;
  reason: string | null;
  until_at: Date | string | null;
  undone_at: Date | string | null;
}

/** What undoing this row means, for the caller to execute. */
export type UndoPlan =
  | { kind: 'keywords'; campaignId: string; keywords: string[]; retired: string[] }
  | { kind: 'posts_per_run'; campaignId: string; value: number }
  | { kind: 'keyword_pause'; campaignId: string; keyword: string }
  | { kind: 'campaign_status'; campaignId: string; status: string }
  | { kind: 'learn_from_orders'; campaignId: string; value: boolean }
  | { kind: 'seasonal_keywords'; campaignId: string; value: boolean }
  // A mute has no side table: the standing, un-undone row IS the mute, which the recycler
  // reads. Stamping undone_at is therefore the whole inverse — nothing else to write.
  | { kind: 'product_mute'; productId: string }
  | { kind: 'copy_angles'; campaignId: string; angles: unknown[] };

interface KeywordsPayload { keywords?: unknown; retired?: unknown }

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];
}

function parse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

/**
 * The one-line Hebrew description shown beside the change — in the brief, in the undo
 * list, and on the dashboard. Always leads with the campaign/group it touched, because
 * "I doubled a keyword" is unreadable without knowing where.
 */
export function actionLabel(row: ActionRow): string {
  const where = row.target_label ? `[${row.target_label}] ` : '';
  switch (row.kind) {
    case 'keywords': {
      const before = parse<KeywordsPayload>(row.before);
      const after = parse<KeywordsPayload>(row.after);
      const from = strings(before?.keywords);
      const to = strings(after?.keywords);
      const added = to.filter((k) => !from.includes(k));
      const removed = from.filter((k) => !to.includes(k));
      // A keyword can also be DOUBLED (a second copy in the rotation) — same list, more of
      // one entry — which neither of the two sets above catches.
      const copies = (list: string[], kw: string) => list.filter((k) => k === kw).length;
      const doubled = Array.from(new Set(to)).filter((k) => copies(to, k) > copies(from, k) && from.includes(k));
      const halved = Array.from(new Set(from)).filter((k) => copies(to, k) < copies(from, k) && to.includes(k));

      const parts: string[] = [];
      if (added.length) parts.push(`הוספתי ${added.map((k) => `"${k}"`).join(', ')}`);
      if (removed.length) parts.push(`הוצאתי ${removed.map((k) => `"${k}"`).join(', ')}`);
      if (doubled.length) parts.push(`הכפלתי ${doubled.map((k) => `"${k}"`).join(', ')}`);
      if (halved.length) parts.push(`החזרתי למינון רגיל ${halved.map((k) => `"${k}"`).join(', ')}`);
      return `${where}${parts.length ? parts.join(', ') : 'עדכנתי את מילות המפתח'}`;
    }
    case 'posts_per_run':
      return `${where}פוסטים לריצה: ${row.before} ← ${row.after}`;
    // keyword_pause is the one kind whose target_label is the KEYWORD, not the group —
    // so it names the word directly instead of using it as a "[where]" prefix.
    case 'keyword_pause':
      return `הפסקתי את "${row.target_label}" ל-24 שעות — הפסיקה להביא קליקים`;
    case 'golden_hours':
      return `${where}עדכנתי את שעות הזהב`;
    case 'campaign_status':
      return row.after === 'active'
        ? `${where}חידשתי את הטייס — הוא הפסיק לפרסם`
        : `${where}השהיתי את הטייס`;
    case 'learn_from_orders':
      return row.after === 'true'
        ? `${where}הדלקתי "למידה ממכירות" — הקטגוריות שמוכרות ייכנסו לרוטציה`
        : `${where}כיביתי "למידה ממכירות"`;
    case 'seasonal_keywords':
      return row.after === 'true'
        ? `${where}הדלקתי מילים עונתיות`
        : `${where}כיביתי מילים עונתיות`;
    case 'product_mute':
      return `${where}הפסקתי לפרסם מחדש את "${row.target_label}" — קליקים בלי מכירה`;
    case 'copy_angles': {
      const before = parse<Array<{ id: string; label: string }>>(row.before) || [];
      const after = parse<Array<{ id: string; label: string }>>(row.after) || [];
      const added = after.filter((a) => !before.some((b) => b.id === a.id));
      const removed = before.filter((b) => !after.some((a) => a.id === b.id));
      if (added.length) return `${where}הוספתי זווית כתיבה: ${added.map((a) => a.label).join(', ')}`;
      if (removed.length) return `${where}הפסקתי זווית כתיבה: ${removed.map((a) => a.label).join(', ')}`;
      return `${where}עדכנתי את זוויות הכתיבה`;
    }
    default:
      return `${where}${row.reason || row.kind}`;
  }
}

/**
 * How to put this row back, or null when there is nothing to put back.
 *
 * Returns the DESIRED state rather than a diff: restoring a whole keyword list cannot
 * half-apply the way "remove this one word" can when the list moved on since.
 */
export function undoPlan(row: ActionRow): UndoPlan | null {
  if (row.undone_at) return null;      // already reversed — a second tap is a no-op
  const campaignId = row.target_id || '';

  switch (row.kind) {
    case 'keywords': {
      const before = parse<KeywordsPayload>(row.before);
      if (!campaignId || !before) return null;
      return {
        kind: 'keywords',
        campaignId,
        keywords: strings(before.keywords),
        retired: strings(before.retired),
      };
    }
    case 'posts_per_run': {
      const value = Number(row.before);
      if (!campaignId || !Number.isFinite(value) || value < 1) return null;
      return { kind: 'posts_per_run', campaignId, value };
    }
    case 'keyword_pause':
      // Undo = end the pause now. The pause has no "before" to restore: its whole effect
      // is the until_at in the future, so expiring it early IS the inverse.
      if (!campaignId || !row.target_label) return null;
      return { kind: 'keyword_pause', campaignId, keyword: row.target_label };
    case 'campaign_status': {
      if (!campaignId || !row.before) return null;
      return { kind: 'campaign_status', campaignId, status: row.before };
    }
    case 'learn_from_orders': {
      if (!campaignId) return null;
      return { kind: 'learn_from_orders', campaignId, value: row.before === 'true' };
    }
    case 'seasonal_keywords': {
      if (!campaignId) return null;
      return { kind: 'seasonal_keywords', campaignId, value: row.before === 'true' };
    }
    case 'product_mute': {
      if (!row.target_id) return null;
      return { kind: 'product_mute', productId: row.target_id };
    }
    case 'copy_angles': {
      const before = parse<unknown[]>(row.before);
      if (!campaignId || !Array.isArray(before)) return null;
      return { kind: 'copy_angles', campaignId, angles: before };
    }
    default:
      // golden_hours and anything unknown: the row is a record of a recomputation, not a
      // change we hold the previous state for.
      return null;
  }
}

export const isUndoable = (row: ActionRow): boolean => undoPlan(row) !== null;
