import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { Post } from '../posts/post.entity';
import { LinkClick } from './link-click.entity';
import { LinkTarget } from './link-target.entity';
import { isBotAgent } from './bot-agents';
import { normalizeClickSource } from './click-source';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; // no 0/O/1/l/I
const CODE_LENGTH = 8;

/**
 * Trackable short links: every post gets a /r/<code> URL that 302-redirects to its
 * affiliate link and records the click. Clicks are the fast feedback loop (minutes,
 * not the weeks a commission report takes) and the weighting signal for attribution.
 */
@Injectable()
export class LinksService {
  private readonly logger = new Logger(LinksService.name);

  constructor(
    @InjectRepository(Post) private readonly posts: Repository<Post>,
    @InjectRepository(LinkClick) private readonly clicks: Repository<LinkClick>,
    @InjectRepository(LinkTarget) private readonly targets: Repository<LinkTarget>,
  ) {}

  /**
   * Persist a code→URL mapping that outlives the post. A /r/<code> link is printed into
   * permanent public posts (Facebook ads, Telegram messages); if the post is later
   * deleted, this durable row keeps the link redirecting to the product instead of the
   * app homepage. Best-effort — never block publishing.
   */
  async recordTarget(code: string, url: string | null | undefined, userId?: string | null): Promise<void> {
    const clean = (code || '').trim();
    const dest = (url || '').trim();
    if (!clean || !dest) return;
    try {
      await this.targets.upsert({ code: clean, url: dest, user_id: userId ?? null }, ['code']);
    } catch (err: any) {
      this.logger.warn(`recordTarget failed for ${clean}: ${err.message}`);
    }
  }

  /** The public base for short links — the frontend domain serves /r/<code>. */
  shortUrl(code: string): string {
    const base = (process.env.SHORT_LINK_BASE || process.env.FRONTEND_URL || '')
      .split(',')[0].trim().replace(/\/$/, '');
    return `${base}/r/${code}`;
  }

  /** The post's short code, minting one on first use. Collisions retry with a fresh code. */
  async ensureCode(post: Post): Promise<string | null> {
    if (post.short_code) return post.short_code;
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = this.generateCode();
      try {
        await this.posts.update(post.id, { short_code: code });
        post.short_code = code;
        return code;
      } catch {
        // unique-index collision (astronomically rare at 8 chars) — try another code
      }
    }
    this.logger.warn(`could not mint short code for post ${post.id}`);
    return null;
  }

  /**
   * A durable short code for a URL that has no post behind it — the storefront's buy
   * buttons, where the product may never have been published to a channel.
   *
   * Idempotent per (owner, url): the store re-renders on every visit, and minting a fresh
   * code each time would fill link_targets with thousands of aliases for one product and
   * scatter its clicks across all of them.
   */
  async mintTarget(url: string, userId?: string | null, kind?: string | null): Promise<string | null> {
    const dest = (url || '').trim();
    if (!dest) return null;
    // Idempotent per (owner, url, kind): the store and the search bot can hand out the same
    // product, and sharing one code would mix their clicks.
    const existing = await this.targets.findOne({
      where: { url: dest, user_id: userId ?? null, kind: kind ? kind : IsNull() },
    }).catch(() => null);
    if (existing) return existing.code;

    for (let attempt = 0; attempt < 3; attempt++) {
      const code = this.generateCode();
      try {
        await this.targets.insert({ code, url: dest, user_id: userId ?? null, kind: kind ?? null });
        return code;
      } catch {
        // unique-index collision (astronomically rare at 8 chars) — try another code
      }
    }
    this.logger.warn(`could not mint a target code for ${dest.slice(0, 80)}`);
    return null;
  }

  /**
   * Resolve a code to its destination and record the click (fire-and-forget — the
   * visitor's redirect must never wait on our bookkeeping). Returns null for unknown codes.
   */
  async click(code: string, referrer?: string, userAgent?: string, source?: string): Promise<string | null> {
    const clean = (code || '').trim();
    if (!clean || clean.length > 16) return null;
    const post = await this.posts.findOne({ where: { short_code: clean } });
    if (!post?.affiliate_url) {
      // Post gone (deleted) or code not on a post → fall back to the durable target so a
      // link already printed into a public ad still reaches the product. No click row to
      // record here (link_clicks needs a post_id), just redirect.
      const target = await this.targets.findOne({ where: { code: clean } }).catch(() => null);
      if (target && !isBotAgent(userAgent)) {
        void this.targets.increment({ code: clean }, 'clicks', 1).catch(() => {});
      }
      return target?.url || null;
    }

    // Preview crawlers are redirected like anyone else, but never counted. Facebook,
    // Telegram and WhatsApp all fetch a posted URL to build its card seconds after
    // publishing — counting those would hand every post a click it never earned, and the
    // optimizer would then retire and boost keywords based on our own preview traffic.
    if (isBotAgent(userAgent)) return post.affiliate_url;

    void (async () => {
      try {
        // ONE transaction: the click row and the cached counter must not be able to
        // disagree. As two separate statements, a hiccup (or a deploy landing between
        // them) logged the row and lost the increment — the posts screen then showed
        // "11 קליקים" above a per-platform breakdown summing to 14.
        await this.clicks.manager.transaction(async (tx) => {
          await tx.insert(LinkClick, {
            post_id: post.id,
            user_id: post.user_id,
            referrer: (referrer || '').slice(0, 500) || null,
            user_agent: (userAgent || '').slice(0, 300) || null,
            // Validated platform tag ('tg'/'fb'/…) from the link's ?s= — see click-source.ts.
            source: normalizeClickSource(source),
          } as Partial<LinkClick>);
          await tx.increment(Post, { id: post.id }, 'clicks_count', 1);
        });
      } catch (err: any) {
        this.logger.warn(`click log failed for ${clean}: ${err.message}`);
      }
    })();

    return post.affiliate_url;
  }

  private generateCode(): string {
    const bytes = randomBytes(CODE_LENGTH);
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    return code;
  }
}
