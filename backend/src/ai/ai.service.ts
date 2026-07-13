import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { DecryptedCredentials } from '../credentials/credentials.service';

export type AiProvider = 'anthropic' | 'openai' | 'gemini';

export interface GenerateImage {
  mime: string;
  data: string; // base64 (no data: prefix)
}

export interface GenerateOptions {
  system: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  /** Optional images for vision — the model describes what it actually sees. */
  images?: GenerateImage[];
}

export interface GenerateResult {
  text: string;
  provider: AiProvider;
  tokens: number;
}

/**
 * Unified multi-provider text generation.
 *
 * Routes a single prompt to Anthropic Claude, OpenAI, or Google Gemini based on
 * the user's `ai_provider` preference, falling back automatically to whichever
 * provider has a usable key. This is the merge point between Nexlify's
 * Claude/OpenAI copy engine and Nexlify's Gemini copywriter.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  /** Returns true if at least one provider has a usable key. */
  hasAnyKey(creds: DecryptedCredentials | null): boolean {
    return !!(creds?.anthropic_api_key || creds?.openai_api_key || creds?.gemini_api_key);
  }

  /** Resolve the effective provider: the chosen one if keyed, else the first keyed provider. */
  resolveProvider(creds: DecryptedCredentials | null): AiProvider | null {
    if (!creds) return null;
    const has: Record<AiProvider, boolean> = {
      anthropic: !!creds.anthropic_api_key,
      openai: !!creds.openai_api_key,
      gemini: !!creds.gemini_api_key,
    };
    const chosen = (creds.ai_provider as AiProvider) || 'anthropic';
    if (has[chosen]) return chosen;
    return (['anthropic', 'openai', 'gemini'] as AiProvider[]).find((p) => has[p]) || null;
  }

  async generate(creds: DecryptedCredentials | null, opts: GenerateOptions): Promise<GenerateResult | null> {
    const provider = this.resolveProvider(creds);
    if (!provider || !creds) return null;

    const maxTokens = opts.maxTokens ?? 600;
    const temperature = opts.temperature ?? 0.85;

    try {
      switch (provider) {
        case 'anthropic':
          return await this.callAnthropic(creds, opts, maxTokens, temperature);
        case 'openai':
          return await this.callOpenAI(creds, opts, maxTokens, temperature);
        case 'gemini':
          return await this.callGemini(creds, opts, maxTokens, temperature);
      }
    } catch (err: any) {
      this.logger.error(`[AI:${provider}] generation failed: ${err?.response?.data?.error?.message || err.message}`);
      return null;
    }
  }

  // ── Anthropic Claude ──────────────────────────────────────────────────────

  private async callAnthropic(
    creds: DecryptedCredentials, opts: GenerateOptions, maxTokens: number, temperature: number,
  ): Promise<GenerateResult> {
    const res = await this.withRetry(() =>
      axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: creds.anthropic_model || 'claude-sonnet-4-6',
          max_tokens: maxTokens,
          temperature,
          system: opts.system,
          messages: [{
            role: 'user',
            content: opts.images?.length
              ? [
                  ...opts.images.map((img) => ({
                    type: 'image',
                    source: { type: 'base64', media_type: img.mime, data: img.data },
                  })),
                  { type: 'text', text: opts.prompt },
                ]
              : opts.prompt,
          }],
        },
        {
          headers: {
            'x-api-key': creds.anthropic_api_key,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          timeout: 25_000,
        },
      ),
    );
    const text = (res.data?.content || [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')
      .trim();
    const usage = res.data?.usage || {};
    return { text, provider: 'anthropic', tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0) };
  }

  // ── OpenAI ────────────────────────────────────────────────────────────────

  private async callOpenAI(
    creds: DecryptedCredentials, opts: GenerateOptions, maxTokens: number, temperature: number,
  ): Promise<GenerateResult> {
    const res = await this.withRetry(() =>
      axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: creds.openai_model || 'gpt-4o-mini',
          max_tokens: maxTokens,
          temperature,
          messages: [
            { role: 'system', content: opts.system },
            {
              role: 'user',
              content: opts.images?.length
                ? [
                    { type: 'text', text: opts.prompt },
                    ...opts.images.map((img) => ({
                      type: 'image_url',
                      image_url: { url: `data:${img.mime};base64,${img.data}` },
                    })),
                  ]
                : opts.prompt,
            },
          ],
        },
        { headers: { Authorization: `Bearer ${creds.openai_api_key}` }, timeout: 25_000 },
      ),
    );
    const text = (res.data?.choices?.[0]?.message?.content || '').trim();
    return { text, provider: 'openai', tokens: res.data?.usage?.total_tokens || 0 };
  }

  // ── Google Gemini ─────────────────────────────────────────────────────────

  private async callGemini(
    creds: DecryptedCredentials, opts: GenerateOptions, maxTokens: number, temperature: number,
  ): Promise<GenerateResult> {
    const model = creds.gemini_model || 'gemini-2.5-flash';
    // gemini-2.5-* are "thinking" models — reasoning tokens can otherwise eat the whole
    // output budget and truncate the post. flash / flash-lite allow disabling thinking
    // (budget 0); gemini-2.5-pro does NOT — it rejects budget 0 (min 128), which would
    // fail the request and silently fall back to generic copy. So branch by model.
    const isPro = /pro/i.test(model);
    const res = await this.withRetry(() =>
      axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${creds.gemini_api_key}`,
        {
          // Gemini has no separate system role — prepend the system prompt. Images (if
          // any) go as inline_data parts so the model describes what it actually sees.
          contents: [{
            parts: [
              { text: `${opts.system}\n\n${opts.prompt}` },
              ...(opts.images || []).map((img) => ({ inline_data: { mime_type: img.mime, data: img.data } })),
            ],
          }],
          generationConfig: {
            temperature,
            // Give headroom so the full post is never cut off mid-sentence (pro also
            // spends part of the budget on thinking, so allow more).
            maxOutputTokens: Math.max(maxTokens, isPro ? 2048 : 1024),
            thinkingConfig: { thinkingBudget: isPro ? 128 : 0 },
          },
        },
        { headers: { 'Content-Type': 'application/json' }, timeout: 25_000 },
      ),
    );
    // Join every text part (a response may be split across parts).
    const parts = res.data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p: any) => p?.text || '').join('').trim();
    const usage = res.data?.usageMetadata || {};
    return { text, provider: 'gemini', tokens: usage.totalTokenCount || 0 };
  }

  // ── Shared retry (handles 429 rate limits) ─────────────────────────────────

  private async withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        const status = err?.response?.status;
        if ((status === 429 || status === 529) && attempt < retries - 1) {
          await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
          continue;
        }
        throw err;
      }
    }
    throw new Error('unreachable');
  }
}
