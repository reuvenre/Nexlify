import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { Campaign } from '../campaigns/campaign.entity';
import { AgentClient } from '../agents/agent-client.service';
import { anthropicInputTokens, EPHEMERAL } from '../ai/anthropic-cache';
import { PersistentValueStore } from '../common/persistent-value.store';
import { UNTRUSTED_DATA_RULE, fenceUntrusted } from '../common/untrusted';
import { ActionRow, actionLabel } from '../optimizer/action-undo';
import {
  CUSTOM_ANGLE_PREFIX, FLYLINK_VARIANTS, customAngleLabel, customVariants, scoreVariants, variantLabel,
} from '../posts/copy-variants';
import { seasonalLedgerKey, seasonalLedgerLine, sumSeasonalRuns, SeasonalLedgerEntry } from '../posts/seasonal-ledger';
import {
  PROPOSAL_KINDS, PROPOSAL_TTL_MS, ProposalCampaign, ProposalDraft, StoredProposal, proposalKey, proposalText, validateProposal,
} from './manager-proposal';

/** Tool turns per question. The last one is forced to answer. */
const MAX_TURNS = 8;
/** Proposals one answer may carry — more than this is a lecture, not advice. */
const MAX_PROPOSALS = 3;
/** Follow-up questions ("ולמה?") see this much of the conversation. */
const HISTORY_TURNS = 3;
const HISTORY_TTL_MS = 30 * 60 * 1000;
const ANSWER_MAX_CHARS = 3500;

const SYSTEM_PROMPT = `You are "המנהל של Nexlify" — the analyst the owner of an affiliate-marketing system talks to.
The system auto-publishes AliExpress products to the owner's Telegram groups, Facebook, Instagram, Pinterest and WhatsApp, in campaigns that each rotate their own search keywords.

How to work:
- Answer from the tools. Read before you conclude; quote the numbers you read. If the data does not answer the question, say exactly what is missing — never guess a number or a cause.
- Answer in Hebrew, addressing the owner in masculine second person. Short, direct, concrete: lead with the answer, then the 2-4 facts behind it. Plain text only (no Markdown, no tables, no **bold**); emoji sparingly.
- You cannot change anything. When the data clearly supports a change, call propose_change; the owner sees it with an approve button and nothing happens until he taps it. Propose only what the evidence supports, at most ${MAX_PROPOSALS} per answer, and mention each proposal in your answer. Never claim a change was made.

What the system's own words mean (from the run notes):
- A keyword's pool is built in tiers; later tiers relax min_rating and min_discount automatically, so rating and discount can never silence a keyword. A keyword that came back empty ("החיפוש לא החזיר מוצרים כלל") is caused by filters sent to the search itself: category_id or min_price/max_price. Never advise lowering rating or discount for an empty keyword.
- "דולגו (הקבוצה תפוסה)" = pacing: the group already had a post booked in that slot. Not an error.
- Seasonal keywords (when the campaign's seasonal toggle is on and a holiday window is open) take a fixed share: one slot after every 4 of the campaign's own keywords. The "📊 עונתי ב-3 ימים" line is the seasonal ledger: slots handed out, published, skipped by pacing, empty searches, swapped by the relevance guard.
- The relevance guard ("שומר הרלוונטיות") rejects a product that plainly does not fit the group's audience and swaps in another.
- Clicks are counted on the system's own short links; preview crawlers are excluded. Week-on-week clicks per campaign are the reliable trend signal; one run is not.
- The optimizer changes things on its own every morning (keywords, posts per run, pauses); recent_changes lists them, and each can be undone.

${UNTRUSTED_DATA_RULE}`;

/**
 * What the weekly review asks. Three kinds of opportunity, each tied to money: words that
 * draw clicks but no sales, demand readers voiced that no campaign answers, and a campaign
 * whose clicks fell. "Nothing worth changing" is a valid answer — proposals only on evidence.
 */
export const WEEKLY_REVIEW_QUESTION = `סקירה שבועית יזומה (אף אחד לא שאל — אתה פותח).
עבור על הנתונים של 7 הימים האחרונים וחפש בדיוק שלושה סוגי הזדמנויות:
1. מילת מפתח שמביאה קליקים בלי הזמנות (keyword_clicks של כל קמפיין פעיל) — קוראים נכנסים ולא קונים.
2. ביקוש בלי מענה: חיפושים שחוזרים בבוט החיפוש (top_searches) ואין להם מילה בשום קמפיין. כשיש english_search — זו המילה להציע.
3. קמפיין שהקליקים שלו ירדו שבוע מול שבוע (clicks_trend), והסיבה לפי הנתונים.
4. זוויות הכתיבה (copy_angles של כל קמפיין פעיל): אם לפתיחות של הפוסטים שהביאו הכי הרבה קליקים יש מכנה משותף שאף זווית קיימת לא מתארת — הצע זווית חדשה (add_copy_angle). זווית מותאמת עם 15+ פוסטים ואפס קליקים — הצע להסיר (remove_copy_angle).
פתח בשורה אחת: מה הדבר הכי חשוב השבוע. אחר כך 2-4 עובדות עם מספרים.
הצע עד 3 שינויים (propose_change), רק כשהנתונים תומכים בהם בבירור. אם אין מה לשנות — אמור זאת בשורה אחת ואל תמציא הצעות.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_campaigns',
    description: 'All campaigns of the owner with their settings, last run time and last run note (truncated). Start here to get campaign ids.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'campaign_details',
    description: 'One campaign in full: keyword rotation, retired keywords, search filters, schedule, send window, recent failures, the full last run note and the 3-day seasonal ledger.',
    input_schema: {
      type: 'object' as const,
      properties: { campaign_id: { type: 'string', description: 'id from list_campaigns' } },
      required: ['campaign_id'],
    },
  },
  {
    name: 'recent_posts',
    description: 'Recent posts with status, error, keyword, clicks and platforms. Filter by campaign and status.',
    input_schema: {
      type: 'object' as const,
      properties: {
        campaign_id: { type: 'string', description: 'optional; all campaigns when omitted' },
        days: { type: 'number', description: '1-14, default 3' },
        status: { type: 'string', enum: ['sent', 'failed', 'scheduled', 'pending', 'any'], description: 'default any' },
        limit: { type: 'number', description: 'max 25, default 15' },
      },
    },
  },
  {
    name: 'keyword_clicks',
    description: 'Posts, clicks, attributed orders and commission (ILS) per keyword for one campaign over the last N days (sent posts only). Many clicks with no orders = readers look but do not buy.',
    input_schema: {
      type: 'object' as const,
      properties: {
        campaign_id: { type: 'string' },
        days: { type: 'number', description: '1-30, default 7' },
      },
      required: ['campaign_id'],
    },
  },
  {
    name: 'clicks_trend',
    description: 'Per active campaign: posts and clicks in the last 7 days against the 7 days before.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'recent_changes',
    description: 'Changes the optimizer (or the owner, via approved proposals) made recently, with reasons and whether they were undone.',
    input_schema: {
      type: 'object' as const,
      properties: { days: { type: 'number', description: '1-14, default 3' } },
    },
  },
  {
    name: 'shopper_bot_stats',
    description: 'The product-search bot that group members use (/find): links it handed out and clicks on them.',
    input_schema: {
      type: 'object' as const,
      properties: { days: { type: 'number', description: '1-30, default 7' } },
    },
  },
  {
    name: 'top_searches',
    description: 'What readers searched for in the search bot, most frequent first, with how many searches found nothing (unmet demand — candidate keywords for a campaign). english_search = the English search that found results when the reader\'s own words did not; it is a ready AliExpress keyword.',
    input_schema: {
      type: 'object' as const,
      properties: { days: { type: 'number', description: '1-30, default 7' } },
    },
  },
  {
    name: 'copy_angles',
    description: 'How each copy angle (the writing angle a post is written in) performs in one campaign: posts, clicks and clicks per post per angle, '
      + 'which angles are custom (owner-approved, removable by id), and the opening lines of recent posts that drew the most clicks and of posts that drew none. '
      + 'Use it to spot what the winning openings share, and to propose a new angle (add_copy_angle) or drop a custom one that does not work (remove_copy_angle).',
    input_schema: {
      type: 'object' as const,
      properties: { campaign_id: { type: 'string' } },
      required: ['campaign_id'],
    },
  },
  {
    name: 'propose_change',
    description: 'Propose ONE change for the owner to approve. Nothing changes until he taps approve. '
      + 'kinds: posts_per_run (integer 1-5), campaign_status ("active"|"paused"), seasonal_keywords (true|false), '
      + 'learn_from_orders (true|false), add_keyword (a search keyword, as the campaign spells its others), '
      + 'remove_keyword (an existing keyword), add_copy_angle (one Hebrew sentence instructing the copywriter, like "זווית כתיבה: פתח/י במחיר מול המחיר בחנות"), '
      + 'remove_copy_angle (the id of a custom angle from copy_angles). The reason must cite the data.',
    input_schema: {
      type: 'object' as const,
      properties: {
        campaign_id: { type: 'string' },
        kind: { type: 'string', enum: [...PROPOSAL_KINDS] },
        value: { type: ['string', 'number', 'boolean'] as any },
        reason: { type: 'string', description: 'Hebrew, one sentence, citing the numbers' },
      },
      required: ['campaign_id', 'kind', 'value', 'reason'],
    },
  },
];

/** Anthropic refused the key itself (401 / authentication_error). */
export function isAuthError(err: any): boolean {
  return err?.status === 401
    || err?.error?.error?.type === 'authentication_error'
    || /invalid x-api-key|authentication_error/i.test(String(err?.message || ''));
}

const clampInt = (v: unknown, min: number, max: number, dflt: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};

export interface ManagerAnswer {
  text: string;
  proposals: StoredProposal[];
  tokens: number;
}

/**
 * The owner's analyst: a read-only tool loop over his own data, with one write path —
 * proposals he approves.
 *
 * Every campaign id the model passes is resolved against the owner's own campaigns before
 * anything is read, so it can neither reach another tenant's data nor act on an id it made
 * up. Titles are seller text and arrive fenced.
 */
@Injectable()
export class ManagerAgentService {
  private readonly logger = new Logger(ManagerAgentService.name);
  private readonly history = new Map<string, { turns: Array<{ q: string; a: string }>; at: number }>();
  private readonly approving = new Set<string>();

  constructor(
    @InjectRepository(Campaign) private readonly campaigns: Repository<Campaign>,
    private readonly agentClient: AgentClient,
    private readonly memory: PersistentValueStore,
  ) {}

  // ── The weekly review ─────────────────────────────────────────────────────

  /**
   * The manager, unasked: once a week it reads the data and brings at most three proposals,
   * each waiting for the owner's tap like any other. A conversation of its own, so a review
   * never becomes the context of the owner's next question.
   */
  async weeklyReview(userId: string): Promise<ManagerAnswer> {
    return this.ask(userId, WEEKLY_REVIEW_QUESTION, `weekly:${userId}`);
  }

  // ── Asking ────────────────────────────────────────────────────────────────

  async ask(userId: string, question: string, conversationKey = userId): Promise<ManagerAnswer> {
    const proposals: StoredProposal[] = [];
    let tokens = 0;

    const messages: Anthropic.MessageParam[] = [];
    for (const t of this.recentTurns(conversationKey)) {
      messages.push({ role: 'user', content: t.q });
      messages.push({ role: 'assistant', content: t.a });
    }
    const today = new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });
    messages.push({ role: 'user', content: `(עכשיו: ${today})\n${question}` });

    let client: Anthropic;
    let model: string;
    try {
      ({ client, model } = await this.agentClient.for(userId));
    } catch (err: any) {
      return { text: `❌ ${err?.message || err}`, proposals, tokens };
    }

    let answer = '';
    for (let turn = 1; turn <= MAX_TURNS; turn++) {
      const last = turn === MAX_TURNS;
      const request = {
        model,
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        // The last turn must answer with what it has rather than ask for more.
        ...(last ? { tool_choice: { type: 'none' as const } } : {}),
        messages,
        cache_control: EPHEMERAL,
      };
      let response: Anthropic.Message;
      try {
        response = await client.messages.create(request);
      } catch (err: any) {
        // A refused key (expired / revoked / mistyped) — try the platform's key once before
        // giving up, so a stale key in settings does not silence the manager.
        const other = isAuthError(err) ? this.agentClient.fallback(client) : null;
        if (!other) throw err;
        this.logger.warn('manager: account Anthropic key refused — retrying with the platform key');
        client = other;
        response = await client.messages.create(request);
      }
      tokens += anthropicInputTokens(response.usage) + response.usage.output_tokens;
      this.agentClient.record(userId, response.usage);

      if (response.stop_reason === 'tool_use' && !last) {
        messages.push({ role: 'assistant', content: response.content });
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;
          let out: unknown;
          try {
            out = await this.runTool(userId, block.name, (block.input || {}) as Record<string, any>, proposals);
          } catch (err: any) {
            this.logger.warn(`manager tool ${block.name} failed: ${err?.message}`);
            out = { error: String(err?.message || err).slice(0, 200) };
          }
          results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(out) });
        }
        if (!results.length) break;
        messages.push({ role: 'user', content: results });
        continue;
      }

      answer = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text).join('\n').trim();
      break;
    }

    if (!answer) answer = 'לא הצלחתי לגבש תשובה מהנתונים. נסה לנסח את השאלה אחרת או לשאול על קמפיין מסוים.';
    if (answer.length > ANSWER_MAX_CHARS) answer = `${answer.slice(0, ANSWER_MAX_CHARS)}…`;
    this.remember(conversationKey, question, answer);
    return { text: answer, proposals, tokens };
  }

  private recentTurns(key: string): Array<{ q: string; a: string }> {
    const h = this.history.get(key);
    if (!h || Date.now() - h.at > HISTORY_TTL_MS) return [];
    return h.turns;
  }

  private remember(key: string, q: string, a: string): void {
    const turns = [...this.recentTurns(key), { q, a: a.slice(0, 1500) }].slice(-HISTORY_TURNS);
    this.history.set(key, { turns, at: Date.now() });
    if (this.history.size > 50) this.history.delete(this.history.keys().next().value as string);
  }

  // ── Tools ─────────────────────────────────────────────────────────────────

  private async ownCampaign(userId: string, id: unknown): Promise<Campaign> {
    const cid = String(id || '').trim();
    const c = /^[0-9a-f-]{36}$/i.test(cid)
      ? await this.campaigns.findOne({ where: { id: cid, user_id: userId } })
      : null;
    if (!c) throw new Error(`no campaign with id "${cid.slice(0, 40)}" — use an id from list_campaigns`);
    return c;
  }

  private async runTool(
    userId: string, name: string, input: Record<string, any>, proposals: StoredProposal[],
  ): Promise<unknown> {
    switch (name) {
      case 'list_campaigns': {
        const rows = await this.campaigns.find({ where: { user_id: userId }, order: { created_at: 'ASC' } });
        return rows.map((c) => ({
          id: c.id, name: c.name, status: c.status, source: c.source,
          use_agents: c.use_agents, seasonal_keywords: c.seasonal_keywords, learn_from_orders: c.learn_from_orders,
          posts_per_run: c.posts_per_run, keywords_count: (c.keywords || []).length,
          schedule_cron: c.schedule_cron, platforms: c.target_platforms, language: c.language,
          last_run_at: c.last_run_at, last_run_note: (c.last_run_note || '').slice(0, 400),
        }));
      }

      case 'campaign_details': {
        const c = await this.ownCampaign(userId, input.campaign_id);
        const ledger = await this.memory.load<SeasonalLedgerEntry[]>(seasonalLedgerKey(c.id));
        return {
          id: c.id, name: c.name, status: c.status, source: c.source, use_agents: c.use_agents,
          keywords: c.keywords, retired_keywords: c.retired_keywords, keyword_cursor: c.keyword_cursor,
          category_id: c.category_id, min_price: c.min_price, max_price: c.max_price,
          min_discount: c.min_discount, min_rating: c.min_rating,
          posts_per_run: c.posts_per_run, schedule_cron: c.schedule_cron,
          send_window: c.window_start_hour != null ? `${c.window_start_hour}-${c.window_end_hour} ${c.window_tz || ''}`.trim() : null,
          platforms: c.target_platforms, language: c.language, currency_pair: c.currency_pair,
          seasonal_keywords: c.seasonal_keywords, learn_from_orders: c.learn_from_orders,
          has_template: !!c.post_template, posts_count: c.posts_count,
          last_run_at: c.last_run_at, next_run_at: c.next_run_at,
          last_run_note: (c.last_run_note || '').slice(0, 1500),
          recent_failures: (c.failed_run_log || []).slice(-5),
          seasonal_ledger_3d: seasonalLedgerLine(sumSeasonalRuns(ledger, Date.now())),
        };
      }

      case 'recent_posts': {
        const days = clampInt(input.days, 1, 14, 3);
        const limit = clampInt(input.limit, 1, 25, 15);
        const status = ['sent', 'failed', 'scheduled', 'pending'].includes(input.status) ? input.status : null;
        const params: any[] = [userId, String(days), limit];
        let where = `p.user_id = $1 AND p.created_at > now() - ($2 || ' days')::interval`;
        if (input.campaign_id) {
          const c = await this.ownCampaign(userId, input.campaign_id);
          params.push(c.id);
          where += ` AND p.campaign_id = $${params.length}`;
        }
        if (status) {
          params.push(status);
          where += ` AND p.status = $${params.length}`;
        }
        const rows: any[] = await this.campaigns.query(
          `SELECT p.product_title, p.keyword, p.status, p.error_message, p.sent_at, p.created_at,
                  p.clicks_count, p.target_platforms, p.delivered_channels, c.name AS campaign
           FROM posts p LEFT JOIN campaigns c ON c.id = p.campaign_id
           WHERE ${where}
           ORDER BY coalesce(p.sent_at, p.created_at) DESC LIMIT $3`,
          params,
        );
        return rows.map((r) => ({
          campaign: r.campaign, title: fenceUntrusted(r.product_title, 80), keyword: r.keyword,
          status: r.status, error: r.error_message ? String(r.error_message).slice(0, 200) : null,
          sent_at: r.sent_at, created_at: r.created_at, clicks: Number(r.clicks_count) || 0,
          platforms: r.target_platforms,
        }));
      }

      case 'keyword_clicks': {
        const c = await this.ownCampaign(userId, input.campaign_id);
        const days = clampInt(input.days, 1, 30, 7);
        const rows: any[] = await this.campaigns.query(
          `SELECT p.keyword, p.posts, p.clicks, coalesce(e.orders, 0)::int AS orders,
                  coalesce(e.commission_ils, 0)::float AS commission_ils
           FROM (SELECT coalesce(lower(trim(keyword)), '(ללא)') AS keyword, count(*)::int AS posts,
                        coalesce(sum(clicks_count), 0)::int AS clicks
                 FROM posts
                 WHERE campaign_id::text = $1::text AND user_id::text = $2::text AND status = 'sent'
                   AND sent_at > now() - ($3 || ' days')::interval
                 GROUP BY 1) p
           LEFT JOIN (SELECT coalesce(lower(trim(keyword)), '(ללא)') AS keyword, count(*) AS orders,
                             sum(commission_ils) AS commission_ils
                      FROM earnings
                      -- earnings.campaign_id is varchar, posts.campaign_id uuid: compare as text
                      WHERE campaign_id::text = $1::text AND user_id::text = $2::text AND status <> 'cancelled'
                        AND order_date > now() - ($3 || ' days')::interval
                      GROUP BY 1) e ON e.keyword = p.keyword
           ORDER BY p.clicks DESC, p.posts DESC LIMIT 40`,
          [c.id, userId, String(days)],
        );
        return {
          campaign: c.name, days,
          keywords: rows.map((r) => ({
            keyword: r.keyword, posts: r.posts, clicks: r.clicks,
            clicks_per_post: r.posts ? +(r.clicks / r.posts).toFixed(2) : 0,
            orders: r.orders, commission_ils: +Number(r.commission_ils).toFixed(2),
          })),
        };
      }

      case 'clicks_trend': {
        const rows: any[] = await this.campaigns.query(
          `SELECT c.name,
                  count(*) FILTER (WHERE p.sent_at > now() - interval '7 days')::int AS recent_posts,
                  coalesce(sum(p.clicks_count) FILTER (WHERE p.sent_at > now() - interval '7 days'), 0)::int AS recent_clicks,
                  count(*) FILTER (WHERE p.sent_at <= now() - interval '7 days')::int AS prior_posts,
                  coalesce(sum(p.clicks_count) FILTER (WHERE p.sent_at <= now() - interval '7 days'), 0)::int AS prior_clicks
           FROM campaigns c
           JOIN posts p ON p.campaign_id = c.id AND p.status = 'sent'
           WHERE c.user_id = $1 AND p.sent_at > now() - interval '14 days'
           GROUP BY c.id, c.name ORDER BY c.name`,
          [userId],
        );
        return rows;
      }

      case 'recent_changes': {
        const days = clampInt(input.days, 1, 14, 3);
        const rows: Array<ActionRow & { created_at: Date }> = await this.campaigns.query(
          `SELECT id, kind, target_id, target_label, "before", "after", reason, until_at, undone_at, created_at
           FROM manager_actions
           WHERE user_id = $1 AND created_at > now() - ($2 || ' days')::interval
           ORDER BY created_at DESC LIMIT 40`,
          [userId, String(days)],
        );
        return rows.map((r) => ({
          what: actionLabel(r), reason: r.reason, undone: !!r.undone_at, at: r.created_at,
        }));
      }

      case 'shopper_bot_stats': {
        const days = clampInt(input.days, 1, 30, 7);
        const [row] = await this.campaigns.query(
          `SELECT count(*)::int AS links,
                  coalesce(sum(clicks), 0)::int AS clicks
           FROM link_targets
           WHERE user_id = $1 AND kind = 'shopper' AND created_at > now() - ($2 || ' days')::interval`,
          [userId, String(days)],
        );
        return { days, links_handed_out: row?.links ?? 0, clicks: row?.clicks ?? 0 };
      }

      case 'top_searches': {
        const days = clampInt(input.days, 1, 30, 7);
        const rows: any[] = await this.campaigns.query(
          `SELECT keyword, count(*)::int AS searches, count(*) FILTER (WHERE results = 0)::int AS found_nothing,
                  max(rewrite) AS english_search
           FROM shopper_searches
           WHERE user_id = $1 AND created_at > now() - ($2 || ' days')::interval
           GROUP BY keyword ORDER BY searches DESC LIMIT 30`,
          [userId, String(days)],
        );
        // Readers' words — third-party text like a product title.
        return {
          days,
          searches: rows.map((r) => ({
            ...r, keyword: fenceUntrusted(r.keyword, 80),
            english_search: r.english_search ? fenceUntrusted(r.english_search, 80) : null,
          })),
        };
      }

      case 'copy_angles': {
        const c = await this.ownCampaign(userId, input.campaign_id);
        const stats: any[] = await this.campaigns.query(
          `SELECT copy_variant AS variant, count(*)::int AS posts, coalesce(sum(clicks_count), 0)::int AS clicks
           FROM posts
           WHERE campaign_id::text = $1::text AND user_id::text = $2::text AND status = 'sent' AND copy_variant IS NOT NULL
           GROUP BY copy_variant`,
          [c.id, userId],
        );
        const custom = Array.isArray(c.copy_angles) ? c.copy_angles : [];
        // Everything still written somewhere (the FLYLINK pool is the shared one plus 'trust').
        const pool = [...FLYLINK_VARIANTS, ...customVariants(custom)];
        const label = (id: string) => custom.find((a) => a.id === id)?.label || variantLabel(id);
        // Openings, not whole posts: the first line is what a reader decides on.
        const opening = (t: string) => fenceUntrusted(String(t || '').replace(/<[^>]*>/g, ' ').split('\n').map((l) => l.trim()).find(Boolean) || '', 140);
        const sample = async (order: string, cond: string) => (await this.campaigns.query(
          `SELECT generated_text, clicks_count, copy_variant FROM posts
           WHERE campaign_id::text = $1::text AND user_id::text = $2::text AND status = 'sent'
             AND sent_at > now() - interval '30 days' AND ${cond}
           ORDER BY ${order} LIMIT 5`,
          [c.id, userId],
        )).map((r: any) => ({ opening: opening(r.generated_text), clicks: r.clicks_count, angle: r.copy_variant ? label(r.copy_variant) : null }));
        return {
          campaign: c.name,
          angles: scoreVariants(stats.map((r) => ({ variant: String(r.variant), posts: r.posts, clicks: r.clicks }))).map((v) => ({
            id: v.variant, label: label(v.variant), posts: v.posts, clicks: v.clicks, clicks_per_post: v.clicksPerPost,
            custom: v.variant.startsWith(CUSTOM_ANGLE_PREFIX), in_use: pool.some((p) => p.id === v.variant),
          })),
          custom_angles: custom.map((a) => ({ id: a.id, label: a.label, instruction: a.hint })),
          most_clicked_openings: await sample('clicks_count DESC, sent_at DESC', 'clicks_count > 0'),
          zero_click_openings: await sample('sent_at DESC', 'clicks_count = 0'),
          note: 'An angle needs about 8 posts before its rate means anything; a new angle is tried first automatically.',
        };
      }

      case 'propose_change': {
        if (proposals.length >= MAX_PROPOSALS) return { error: `at most ${MAX_PROPOSALS} proposals per answer` };
        const c = await this.ownCampaign(userId, input.campaign_id);
        const v = validateProposal(input, this.proposalCampaign(c));
        if ('error' in v) return { error: v.error };
        const stored: StoredProposal = { ...v.draft, id: randomUUID(), userId, createdAt: Date.now() };
        await this.memory.save(proposalKey(stored.id), stored, PROPOSAL_TTL_MS);
        proposals.push(stored);
        return { ok: true, shown_to_owner_as: proposalText(stored) };
      }

      default:
        return { error: `unknown tool ${name}` };
    }
  }

  private proposalCampaign(c: Campaign): ProposalCampaign {
    return {
      id: c.id, name: c.name, status: c.status, posts_per_run: c.posts_per_run,
      seasonal_keywords: !!c.seasonal_keywords, learn_from_orders: !!c.learn_from_orders,
      keywords: c.keywords || [],
      copy_angles: Array.isArray(c.copy_angles) ? c.copy_angles : [],
    };
  }

  // ── Approving ─────────────────────────────────────────────────────────────

  /** The owner tapped "אשר". Re-checks against the live campaign, applies, logs an undoable action. */
  async approve(userId: string, proposalId: string): Promise<{ ok: boolean; message: string }> {
    if (this.approving.has(proposalId)) return { ok: false, message: 'כבר מטפל בהצעה הזו' };
    this.approving.add(proposalId);
    try {
      const p = await this.memory.load<StoredProposal>(proposalKey(proposalId));
      if (!p || p.userId !== userId) return { ok: false, message: 'ההצעה פגה — שאל שוב ואקבל נתונים עדכניים' };
      if (p.resolved) return { ok: false, message: p.resolved === 'approved' ? 'ההצעה כבר בוצעה' : 'ההצעה נדחתה' };

      const c = await this.campaigns.findOne({ where: { id: p.campaignId, user_id: userId } });
      if (!c) return { ok: false, message: 'הקמפיין לא נמצא' };
      const v = validateProposal({ kind: p.kind, value: p.value, reason: p.reason }, this.proposalCampaign(c));
      if ('error' in v) return { ok: false, message: `המצב השתנה מאז ההצעה, לא בוצע (${v.error})` };

      await this.apply(userId, c, v.draft);
      await this.memory.save(proposalKey(p.id), { ...p, resolved: 'approved' }, PROPOSAL_TTL_MS);
      return { ok: true, message: `✅ בוצע: ${proposalText(v.draft)}\nאפשר לבטל דרך "↩️ בטל שינוי" בדוח הבוקר.` };
    } catch (err: any) {
      this.logger.warn(`approve ${proposalId} failed: ${err?.message}`);
      return { ok: false, message: 'הביצוע נכשל — לא שונה כלום' };
    } finally {
      this.approving.delete(proposalId);
    }
  }

  async reject(userId: string, proposalId: string): Promise<string> {
    const p = await this.memory.load<StoredProposal>(proposalKey(proposalId));
    if (p && p.userId === userId && !p.resolved) {
      await this.memory.save(proposalKey(p.id), { ...p, resolved: 'rejected' }, PROPOSAL_TTL_MS);
      return `נדחה: ${proposalText(p)}`;
    }
    return 'ההצעה כבר טופלה או פגה';
  }

  private async apply(userId: string, c: Campaign, d: ProposalDraft): Promise<void> {
    const q = (sql: string, params: any[]) => this.campaigns.query(sql, params);
    const reason = `אושר על ידך מהמנהל: ${d.reason}`;
    const log = (kind: string, before: string, after: string) => q(
      `INSERT INTO manager_actions (user_id, kind, target_id, target_label, "before", "after", reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [userId, kind, c.id, c.name, before, after, reason],
    );

    switch (d.kind) {
      case 'add_copy_angle':
      case 'remove_copy_angle': {
        const before = Array.isArray(c.copy_angles) ? c.copy_angles : [];
        const hint = String(d.value);
        const after = d.kind === 'add_copy_angle'
          ? [...before, { id: `${CUSTOM_ANGLE_PREFIX}${randomUUID().slice(0, 8)}`, label: customAngleLabel(hint), hint, created_at: new Date().toISOString() }]
          : before.filter((a) => a.id !== hint);
        await q(`UPDATE campaigns SET copy_angles = $1::jsonb WHERE id = $2 AND user_id = $3`, [JSON.stringify(after), c.id, userId]);
        await log('copy_angles', JSON.stringify(before), JSON.stringify(after));
        return;
      }
      case 'posts_per_run':
        await q(`UPDATE campaigns SET posts_per_run = $1 WHERE id = $2 AND user_id = $3`, [d.value, c.id, userId]);
        await log('posts_per_run', String(d.current), String(d.value));
        return;
      case 'campaign_status':
        await q(`UPDATE campaigns SET status = $1 WHERE id = $2 AND user_id = $3`, [d.value, c.id, userId]);
        await log('campaign_status', String(d.current), String(d.value));
        return;
      case 'seasonal_keywords':
      case 'learn_from_orders':
        await q(`UPDATE campaigns SET ${d.kind} = $1 WHERE id = $2 AND user_id = $3`, [!!d.value, c.id, userId]);
        await log(d.kind, String(!!d.current), String(!!d.value));
        return;
      case 'add_keyword':
      case 'remove_keyword': {
        const keywords = c.keywords || [];
        const retired = c.retired_keywords || [];
        const kw = String(d.value);
        const same = (k: string) => k.trim().toLowerCase() === kw.toLowerCase();
        const next = d.kind === 'add_keyword'
          ? { keywords: [...keywords, kw], retired: retired.filter((k) => !same(k)) }
          // Removed words go to the retired list — visible and restorable, like the optimizer's.
          : { keywords: keywords.filter((k) => !same(k)), retired: retired.some(same) ? retired : [...retired, kw] };
        await q(`UPDATE campaigns SET keywords = $1, retired_keywords = $2 WHERE id = $3 AND user_id = $4`,
          [next.keywords, next.retired, c.id, userId]);
        await log('keywords', JSON.stringify({ keywords, retired }), JSON.stringify(next));
        return;
      }
    }
  }
}
