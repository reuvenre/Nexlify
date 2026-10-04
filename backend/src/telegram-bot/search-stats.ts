/**
 * The readers' searches, summed up for the owner (/searches, the manager agent).
 */

export interface SearchCountRow {
  keyword: string;
  searches: number;
  /** Searches of this keyword that found nothing to show. */
  empty: number;
}

/** A search term as it is stored and grouped: lower-case, single spaces, capped. */
export function normaliseSearch(keyword: string): string {
  return String(keyword || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80);
}

export function searchesReport(rows: SearchCountRow[], days: number, total: number): string {
  if (!total) return `🔎 עוד אין חיפושים בבוט ב-${days} הימים האחרונים.`;
  const lines = [`🔎 מה מחפשים בבוט — ${days} ימים אחרונים (${total} חיפושים):`, ''];
  rows.slice(0, 10).forEach((r, i) => {
    const miss = r.empty ? ` · ${r.empty === r.searches ? 'לא נמצא כלום' : `${r.empty} בלי תוצאות`}` : '';
    lines.push(`${i + 1}. ${r.keyword} — ${r.searches}${miss}`);
  });
  const unmet = rows.filter((r) => r.empty === r.searches).slice(0, 5);
  if (unmet.length) {
    lines.push('', `⚠️ ביקוש בלי מענה: ${unmet.map((r) => r.keyword).join(', ')}`);
  }
  lines.push('', '💡 מילה שחוזרת הרבה — מועמדת טובה לרוטציה של קמפיין.');
  return lines.join('\n');
}
