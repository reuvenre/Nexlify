import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiUsage } from './ai-usage.entity';

export interface DailyUsage {
  day: string;
  total_tokens: number;
  prompt_tokens: number;
  output_tokens: number;
  calls: number;
}

export interface UsageSummary {
  today: DailyUsage;
  month_total: number;
  days: DailyUsage[]; // ascending by day, last N days
  budget: number | null; // monthly token budget (user-set), null = not configured
  remaining: number | null; // budget - month_total (>= 0), null if no budget
  by_provider: { provider: string; total_tokens: number }[];
}

const TZ = 'Asia/Jerusalem';

/** Calendar day (YYYY-MM-DD) for a moment, in the user's timezone. */
function dayInTz(d = new Date()): string {
  // en-CA renders as YYYY-MM-DD.
  return d.toLocaleDateString('en-CA', { timeZone: TZ });
}

@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name);

  constructor(
    @InjectRepository(AiUsage) private readonly repo: Repository<AiUsage>,
  ) {}

  /**
   * Increment today's usage row for (user, provider). Best-effort: metering must
   * never break or slow a generation, so failures are swallowed and logged.
   */
  async record(userId: string, provider: string, prompt: number, output: number, total: number): Promise<void> {
    if (!userId) return;
    const day = dayInTz();
    const p = Math.max(0, Math.round(prompt || 0));
    const o = Math.max(0, Math.round(output || 0));
    const t = Math.max(0, Math.round(total || (p + o)));
    try {
      await this.repo.query(
        `INSERT INTO ai_usage (id, user_id, day, provider, prompt_tokens, output_tokens, total_tokens, calls, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 1, now(), now())
         ON CONFLICT ON CONSTRAINT uq_ai_usage_user_day_provider DO UPDATE SET
           prompt_tokens = ai_usage.prompt_tokens + EXCLUDED.prompt_tokens,
           output_tokens = ai_usage.output_tokens + EXCLUDED.output_tokens,
           total_tokens  = ai_usage.total_tokens  + EXCLUDED.total_tokens,
           calls         = ai_usage.calls + 1,
           updated_at    = now()`,
        [userId, day, provider || 'gemini', p, o, t],
      );
    } catch (err: any) {
      this.logger.warn(`ai-usage record failed: ${err?.message || err}`);
    }
  }

  /** Usage summary for the dashboard: today, last `days`, month-to-date, budget/remaining. */
  async summary(userId: string, budget: number | null, days = 14): Promise<UsageSummary> {
    const today = dayInTz();
    const monthStart = `${today.slice(0, 7)}-01`;
    const since = dayInTz(new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000));

    // Daily rollup across providers for the chart window.
    const rows: any[] = await this.repo.query(
      `SELECT day::text AS day,
              SUM(total_tokens)::bigint  AS total_tokens,
              SUM(prompt_tokens)::bigint AS prompt_tokens,
              SUM(output_tokens)::bigint AS output_tokens,
              SUM(calls)::int            AS calls
       FROM ai_usage
       WHERE user_id = $1 AND day >= $2
       GROUP BY day ORDER BY day ASC`,
      [userId, since],
    );

    const monthRow: any[] = await this.repo.query(
      `SELECT COALESCE(SUM(total_tokens), 0)::bigint AS month_total
       FROM ai_usage WHERE user_id = $1 AND day >= $2`,
      [userId, monthStart],
    );

    const providerRows: any[] = await this.repo.query(
      `SELECT provider, SUM(total_tokens)::bigint AS total_tokens
       FROM ai_usage WHERE user_id = $1 AND day >= $2
       GROUP BY provider ORDER BY total_tokens DESC`,
      [userId, monthStart],
    );

    const byDay = new Map<string, DailyUsage>();
    for (const r of rows) {
      byDay.set(r.day, {
        day: r.day,
        total_tokens: Number(r.total_tokens) || 0,
        prompt_tokens: Number(r.prompt_tokens) || 0,
        output_tokens: Number(r.output_tokens) || 0,
        calls: Number(r.calls) || 0,
      });
    }

    // Fill every day in the window (zeros for idle days) so the chart is continuous.
    const series: DailyUsage[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = dayInTz(new Date(Date.now() - i * 24 * 60 * 60 * 1000));
      series.push(byDay.get(d) || { day: d, total_tokens: 0, prompt_tokens: 0, output_tokens: 0, calls: 0 });
    }

    const month_total = Number(monthRow?.[0]?.month_total) || 0;
    const todayUsage = byDay.get(today) || { day: today, total_tokens: 0, prompt_tokens: 0, output_tokens: 0, calls: 0 };
    const remaining = budget != null ? Math.max(0, budget - month_total) : null;

    return {
      today: todayUsage,
      month_total,
      days: series,
      budget: budget ?? null,
      remaining,
      by_provider: providerRows.map((r) => ({ provider: r.provider, total_tokens: Number(r.total_tokens) || 0 })),
    };
  }
}
