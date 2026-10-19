/**
 * Which group does a hand-picked product belong to? (PostsService.routeProduct)
 *
 * The owner asked that every product he picks by hand (quick post, the products screen, the
 * high-commission screen, the Telegram bot) be placed in its group by the system, and that it
 * ask only when it cannot tell. And that the post be written in the template a post to that
 * group gets when it goes out automatically.
 *
 * The answer is a campaign, because that is how automatic posts reach a group: a campaign
 * targets groups, and writes in `campaign.post_template`, else the account default (the
 * runCampaign rule). Three ways to know the campaign, strongest first:
 *  1. the keyword that found the product is in exactly one campaign's rotation (the commission
 *     scout says which keyword found it);
 *  2. a campaign already posted this product (campaign_posted_products);
 *  3. the smart-intake judge (smart-intake.ts), one model call, by audience, now also shown each
 *     group's core focus.
 * Anything short of that is a question to the owner, never a guess: a wrong guess posts to a
 * real group of real people.
 *
 * Kept free of Nest so the decisions can be unit tested.
 */

export interface RouteCampaign {
  id: string;
  name: string;
  status: string;
  keywords: string[];
  /** Telegram chat ids; empty = the account's default channel. */
  targets: string[];
}

export type RouteMethod = 'keyword' | 'history' | 'ai' | 'chosen' | 'group';

export interface ProductRoute {
  /** False = the owner is asked (options). */
  confident: boolean;
  method: RouteMethod | null;
  /** Hebrew, shown to the owner. */
  reason: string;
  campaign: { id: string; name: string } | null;
  /** Telegram chat ids to publish to; empty = the default channel. */
  channels: string[];
  group_names: string[];
  /** The body template an automatic post to these groups is written with ('' = the built-in voice). */
  template: string;
  template_source: 'campaign' | 'account' | 'group' | 'none';
  language: string;
  /** When not confident: the groups to choose from. */
  options: Array<{ channel_id: string; name: string; campaign_name: string | null }>;
}

const norm = (s: string) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The campaign whose rotation holds this exact keyword. Several campaigns holding it count only
 * when they all feed the same groups (then it does not matter which); otherwise it is not an answer.
 */
export function campaignByKeyword(campaigns: RouteCampaign[], keyword?: string): RouteCampaign | null {
  const k = norm(keyword || '');
  if (!k) return null;
  const hits = campaigns.filter((c) => (c.keywords || []).some((w) => norm(w) === k));
  if (!hits.length) return null;
  if (hits.length === 1) return hits[0];
  const key = (c: RouteCampaign) => [...c.targets].sort().join(',');
  return hits.every((c) => key(c) === key(hits[0])) ? preferActive(hits) : null;
}

/** The campaign an automatic post to this group comes from: active first, then paused. */
export function campaignForGroup(campaigns: RouteCampaign[], channelId: string): RouteCampaign | null {
  return preferActive(campaigns.filter((c) => c.targets.includes(channelId)));
}

function preferActive(list: RouteCampaign[]): RouteCampaign | null {
  return list.find((c) => c.status === 'active') || list[0] || null;
}

export function methodReason(method: RouteMethod, detail: string): string {
  switch (method) {
    case 'keyword': return `זוהה לפי מילת המפתח «${detail}» של הקמפיין`;
    case 'history': return 'הקמפיין הזה כבר פרסם את המוצר';
    case 'ai': return detail ? `זוהה לפי קהל היעד: ${detail}` : 'זוהה לפי קהל היעד של הקבוצה';
    case 'chosen': return 'בחרת את הקבוצה';
    case 'group': return 'בחרת את הקבוצה (אין קמפיין שמפרסם אליה)';
  }
}
