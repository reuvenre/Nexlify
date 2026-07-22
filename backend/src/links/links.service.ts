import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { Post } from '../posts/post.entity';
import { LinkClick } from './link-click.entity';

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
  ) {}

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
   * Resolve a code to its destination and record the click (fire-and-forget — the
   * visitor's redirect must never wait on our bookkeeping). Returns null for unknown codes.
   */
  async click(code: string, referrer?: string, userAgent?: string): Promise<string | null> {
    const clean = (code || '').trim();
    if (!clean || clean.length > 16) return null;
    const post = await this.posts.findOne({ where: { short_code: clean } });
    if (!post?.affiliate_url) return null;

    void (async () => {
      try {
        await this.clicks.insert({
          post_id: post.id,
          user_id: post.user_id,
          referrer: (referrer || '').slice(0, 500) || null,
          user_agent: (userAgent || '').slice(0, 300) || null,
        } as Partial<LinkClick>);
        await this.posts.increment({ id: post.id }, 'clicks_count', 1);
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
