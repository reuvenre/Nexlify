import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { CredentialsService } from '../credentials/credentials.service';
import { AiUsageService } from '../ai/ai-usage.service';
import { anthropicInputTokens } from '../ai/anthropic-cache';

/** Used when the account has no model preference of its own. */
const DEFAULT_MODEL = 'claude-sonnet-4-6';

/**
 * Resolves the Anthropic client the AGENTS should talk to, per user.
 *
 * The agents used to build one client at construction time from the server's
 * ANTHROPIC_API_KEY, which meant two things: a customer who had pasted their own key still
 * ran on the platform's account, and none of that spend showed up in their token meter —
 * every Autopilot campaign billed silently to the operator. Resolving per call puts agent
 * usage on the same footing as the rest of AI generation: the user's key when they have
 * one, the platform key as the fallback that keeps a new account working on day one, and
 * metering either way.
 */
@Injectable()
export class AgentClient {
  private readonly logger = new Logger(AgentClient.name);
  /** Clients are stateless over a key — reuse rather than rebuild per call. */
  private readonly cache = new Map<string, Anthropic>();

  constructor(
    private readonly credentials: CredentialsService,
    private readonly usage: AiUsageService,
  ) {}

  async for(userId: string): Promise<{ client: Anthropic; model: string }> {
    const creds = await this.credentials.getRaw(userId).catch(() => null);
    // getRaw() already falls back to the platform key; the env read here only covers the
    // case where the credentials lookup itself failed.
    const apiKey = creds?.anthropic_api_key || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('לא הוגדר מפתח Anthropic — הזן מפתח בהגדרות או פנה לתמיכה');
    }
    let client = this.cache.get(apiKey);
    if (!client) {
      client = new Anthropic({ apiKey });
      this.cache.set(apiKey, client);
    }
    return { client, model: creds?.anthropic_model || DEFAULT_MODEL };
  }

  /**
   * The platform's own client, when the account's key is a different one — the second try
   * after the account's key is refused (expired, revoked, mistyped in settings). Null when
   * there is no platform key or it is the same key that just failed.
   */
  fallback(failed: Anthropic): Anthropic | null {
    const platform = (process.env.ANTHROPIC_API_KEY || '').trim();
    if (!platform || failed.apiKey === platform) return null;
    let client = this.cache.get(platform);
    if (!client) {
      client = new Anthropic({ apiKey: platform });
      this.cache.set(platform, client);
    }
    return client;
  }

  /** Meter one agent turn. Best-effort — metering must never break a run. */
  record(userId: string, usage: Parameters<typeof anthropicInputTokens>[0] & { output_tokens: number }): void {
    const input = anthropicInputTokens(usage);
    void this.usage.record(
      userId, 'anthropic', input, usage.output_tokens,
      input + usage.output_tokens,
    ).catch((err) => this.logger.warn(`agent usage record failed: ${err?.message || err}`));
  }
}
