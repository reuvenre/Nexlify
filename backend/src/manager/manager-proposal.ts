import { MAX_POSTS_PER_RUN, MIN_POSTS_PER_RUN } from '../optimizer/manager-rules';

/**
 * A change the manager agent wants to make, waiting for the owner's tap.
 *
 * The manager can READ everything and CHANGE nothing. When the data says a campaign should
 * be different, it files a proposal; the owner sees it in plain Hebrew with "אשר" / "דחה",
 * and only an approval writes. This is the staged-write pattern: the model's judgement is
 * advice, the owner's tap is the authority.
 *
 * Every proposal is validated twice against the live campaign — once when the model files
 * it (so a nonsense proposal is refused back to the model, not shown to the owner) and
 * again at approval (the campaign may have moved on since). Only a fixed set of fields can
 * be proposed at all, each within the same bounds the optimizer works inside.
 */

export const PROPOSAL_KINDS = [
  'posts_per_run', 'campaign_status', 'seasonal_keywords', 'learn_from_orders', 'add_keyword', 'remove_keyword',
] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

/** The campaign fields a proposal is checked against. */
export interface ProposalCampaign {
  id: string;
  name: string;
  status: string;
  posts_per_run: number;
  seasonal_keywords: boolean;
  learn_from_orders: boolean;
  keywords: string[];
}

export interface ProposalDraft {
  campaignId: string;
  campaignName: string;
  kind: ProposalKind;
  value: number | string | boolean;
  /** The value right now — shown beside the new one, and what an undo puts back. */
  current: number | string | boolean;
  reason: string;
}

export interface StoredProposal extends ProposalDraft {
  id: string;
  userId: string;
  createdAt: number;
  /** Set once approved or rejected — a second tap must not apply it twice. */
  resolved?: 'approved' | 'rejected';
}

/** A proposal lives a day; after that the data it was based on is stale. */
export const PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000;
export const proposalKey = (id: string) => `manager_proposal:${id}`;

const KEYWORD_MAX = 60;

function asBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  const s = String(v ?? '').trim().toLowerCase();
  if (['true', 'on', '1', 'yes', 'כן', 'פעיל', 'הפעל'].includes(s)) return true;
  if (['false', 'off', '0', 'no', 'לא', 'כבוי', 'כבה'].includes(s)) return false;
  return null;
}

function cleanKeyword(v: unknown): string {
  return String(v ?? '').replace(/[\u0000-\u001F\u007F-\u009F⟦⟧]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Check one proposal against the live campaign. */
export function validateProposal(
  input: { kind?: unknown; value?: unknown; reason?: unknown },
  campaign: ProposalCampaign,
): { ok: true; draft: ProposalDraft } | { ok: false; error: string } {
  const kind = String(input.kind || '') as ProposalKind;
  if (!(PROPOSAL_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, error: `unknown change kind "${kind}"; allowed: ${PROPOSAL_KINDS.join(', ')}` };
  }
  const reason = String(input.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!reason) return { ok: false, error: 'a reason grounded in the data is required' };
  const base = { campaignId: campaign.id, campaignName: campaign.name, kind, reason };

  switch (kind) {
    case 'posts_per_run': {
      const n = Number(input.value);
      if (!Number.isInteger(n) || n < MIN_POSTS_PER_RUN || n > MAX_POSTS_PER_RUN) {
        return { ok: false, error: `posts_per_run must be an integer ${MIN_POSTS_PER_RUN}-${MAX_POSTS_PER_RUN}` };
      }
      if (n === campaign.posts_per_run) return { ok: false, error: `posts_per_run is already ${n}` };
      return { ok: true, draft: { ...base, value: n, current: campaign.posts_per_run } };
    }
    case 'campaign_status': {
      const s = String(input.value ?? '').trim().toLowerCase();
      if (s !== 'active' && s !== 'paused') return { ok: false, error: 'campaign_status must be "active" or "paused"' };
      if (s === campaign.status) return { ok: false, error: `campaign is already ${s}` };
      return { ok: true, draft: { ...base, value: s, current: campaign.status } };
    }
    case 'seasonal_keywords':
    case 'learn_from_orders': {
      const b = asBool(input.value);
      if (b === null) return { ok: false, error: `${kind} must be true or false` };
      const current = !!campaign[kind];
      if (b === current) return { ok: false, error: `${kind} is already ${b}` };
      return { ok: true, draft: { ...base, value: b, current } };
    }
    case 'add_keyword': {
      const kw = cleanKeyword(input.value);
      if (kw.length < 2 || kw.length > KEYWORD_MAX) return { ok: false, error: `keyword must be 2-${KEYWORD_MAX} characters` };
      if (/https?:|www\./i.test(kw)) return { ok: false, error: 'a keyword cannot be a link' };
      if (campaign.keywords.some((k) => k.trim().toLowerCase() === kw.toLowerCase())) {
        return { ok: false, error: `"${kw}" is already in the rotation` };
      }
      return { ok: true, draft: { ...base, value: kw, current: campaign.keywords.length } };
    }
    case 'remove_keyword': {
      const kw = cleanKeyword(input.value);
      const hit = campaign.keywords.find((k) => k.trim().toLowerCase() === kw.toLowerCase());
      if (!hit) return { ok: false, error: `"${kw}" is not in the rotation` };
      if (new Set(campaign.keywords.map((k) => k.trim().toLowerCase())).size <= 1) {
        return { ok: false, error: 'cannot remove the last keyword' };
      }
      return { ok: true, draft: { ...base, value: hit, current: campaign.keywords.length } };
    }
  }
}

const onOff = (v: unknown) => (v ? 'פעיל' : 'כבוי');
const statusHe = (v: unknown) => (v === 'active' ? 'פעיל' : v === 'paused' ? 'מושהה' : String(v));

/** The owner-facing line for a proposal. */
export function proposalText(p: ProposalDraft): string {
  const where = `[${p.campaignName}]`;
  switch (p.kind) {
    case 'posts_per_run': return `${where} פוסטים לריצה: ${p.current} ← ${p.value}`;
    case 'campaign_status': return `${where} מצב הקמפיין: ${statusHe(p.current)} ← ${statusHe(p.value)}`;
    case 'seasonal_keywords': return `${where} מילים עונתיות: ${onOff(p.current)} ← ${onOff(p.value)}`;
    case 'learn_from_orders': return `${where} למידה ממכירות: ${onOff(p.current)} ← ${onOff(p.value)}`;
    case 'add_keyword': return `${where} להוסיף לרוטציה את "${p.value}"`;
    case 'remove_keyword': return `${where} להוציא מהרוטציה את "${p.value}"`;
  }
}
