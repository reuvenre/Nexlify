import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { DecryptedCredentials } from '../credentials/credentials.service';
import { AiUsageService } from './ai-usage.service';
import { anthropicInputTokens, cachedSystem } from './anthropic-cache';
import { finishReasonTruncated } from './finish-reason';
import { geminiOutputBudget } from './gemini-budget';

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
  /**
   * A non-empty draft the provider cut at the token budget fails over to the next keyed
   * provider instead of being returned as-is (the same model retried at a similar budget
   * usually truncates identically — issue #62). The first truncated draft is kept as a
   * last resort so the caller's own truncation handling still has something to act on.
   * Opt-in: tiny fixed-budget calls (the copy judge answers in ≤24 tokens) hit the cap
   * by design and must NOT burn a second provider on it.
   */
  truncationFailover?: boolean;
}

export interface GenerateResult {
  text: string;
  provider: AiProvider;
  tokens: number;
  promptTokens?: number;
  outputTokens?: number;
  /** The provider stopped at the token budget — the text is cut, not finished. */
  truncated?: boolean;
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

  /** Working Gemini IMAGE model per api-key (discovered at runtime). Model families
   *  retire without notice (see the gemini-2.5-flash saga) — discovery + cache means
   *  image generation self-heals instead of silently dying with the model. */
  private readonly geminiImageModelCache = new Map<string, string>();

  constructor(private readonly usage: AiUsageService) {}

  /**
   * Redesign/enhance a product photo with Gemini's image model ("Nano Banana"),
   * using the user's own Gemini key. Returns the generated image bytes, or null on
   * any failure — callers MUST fall back (e.g. to the local studio pass); publishing
   * never depends on this succeeding.
   */
  async generateProductImage(
    creds: DecryptedCredentials | null,
    image: GenerateImage,
    prompt: string,
  ): Promise<{ data: Buffer; mime: string } | null> {
    const key = creds?.gemini_api_key;
    if (!key) return null;
    const cacheKey = key.slice(0, 12);
    const tried = new Set<string>();
    let model: string | null = this.geminiImageModelCache.get(cacheKey) || 'gemini-2.5-flash-image';

    for (let attempt = 0; attempt < 2; attempt++) {
      if (!model || tried.has(model)) model = await this.discoverGeminiImageModel(key);
      if (!model || tried.has(model)) return null;
      tried.add(model);
      try {
        const res = await this.withRetry(() =>
          axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
            {
              contents: [{ parts: [
                { text: prompt },
                { inline_data: { mime_type: image.mime, data: image.data } },
              ] }],
              generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
            },
            { headers: { 'Content-Type': 'application/json' }, timeout: 60_000 },
          ),
        );
        const parts = res.data?.candidates?.[0]?.content?.parts || [];
        for (const p of parts) {
          const inline = p?.inlineData || p?.inline_data;
          if (inline?.data) {
            this.geminiImageModelCache.set(cacheKey, model);
            return { data: Buffer.from(inline.data, 'base64'), mime: inline.mimeType || inline.mime_type || 'image/png' };
          }
        }
        this.logger.warn(`[AI:image] ${model} returned no image part`);
        return null; // model worked but produced no image (e.g. safety) — don't thrash discovery
      } catch (err: any) {
        const msg = err?.response?.data?.error?.message || err.message;
        this.logger.warn(`[AI:image] ${model} failed: ${msg}`);
        // Model unavailable/retired → discover what THIS key can use and retry once.
        if (err?.response?.status === 404 || /not (available|found|supported)/i.test(String(msg))) {
          this.geminiImageModelCache.delete(cacheKey);
          model = null; // force discovery on the next attempt
          continue;
        }
        return null;
      }
    }
    return null;
  }

  /** First image-capable Gemini model this key can use, from Google's live catalog. */
  private async discoverGeminiImageModel(key: string): Promise<string | null> {
    try {
      const res = await axios.get(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=100`,
        { timeout: 8000 },
      );
      const names: string[] = (res.data?.models || [])
        .filter((m: any) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m: any) => String(m.name || '').replace(/^models\//, ''))
        .filter((n: string) => /^gemini/i.test(n) && /image/i.test(n) && !/preview-\d{2}/i.test(n));
      // Prefer flash-image (cheapest); otherwise the newest image model.
      names.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      const pick = names.find((n) => /flash-image/i.test(n)) || names[0] || null;
      if (pick) this.logger.log(`[AI:image] discovered image model: ${pick}`);
      return pick;
    } catch {
      return null;
    }
  }

  /** Returns true if at least one provider has a usable key. */
  hasAnyKey(creds: DecryptedCredentials | null): boolean {
    return !!(creds?.anthropic_api_key || creds?.openai_api_key || creds?.gemini_api_key);
  }

  /** Resolve the effective provider: the chosen one if keyed, else the first keyed provider. */
  resolveProvider(creds: DecryptedCredentials | null): AiProvider | null {
    return this.providerOrder(creds)[0] || null;
  }

  /**
   * Keyed providers in try-order: the chosen one first, then the others that ALSO have a
   * key — the failover chain. So if the primary provider errors or returns empty at runtime,
   * generate() falls back to a real second AI instead of the dumb defaultText (which is what
   * made posts go out with the raw English title / ignoring the campaign template).
   */
  private providerOrder(creds: DecryptedCredentials | null): AiProvider[] {
    if (!creds) return [];
    const has: Record<AiProvider, boolean> = {
      anthropic: !!creds.anthropic_api_key,
      openai: !!creds.openai_api_key,
      gemini: !!creds.gemini_api_key,
    };
    const chosen = (creds.ai_provider as AiProvider) || 'anthropic';
    const all: AiProvider[] = ['anthropic', 'openai', 'gemini'];
    return [chosen, ...all.filter((p) => p !== chosen)].filter((p) => has[p]);
  }

  async generate(creds: DecryptedCredentials | null, opts: GenerateOptions): Promise<GenerateResult | null> {
    if (!creds) return null;
    const order = this.providerOrder(creds);
    if (!order.length) return null;

    const maxTokens = opts.maxTokens ?? 600;
    const temperature = opts.temperature ?? 0.85;

    // Try each keyed provider in order; move on when one errors OR returns empty text, so a
    // single provider hiccup (bad key, quota, retired model, safety-block) doesn't dump the
    // post to generic default copy while another usable provider sits idle.
    let truncatedFallback: GenerateResult | null = null;
    for (let i = 0; i < order.length; i++) {
      const provider = order[i];
      try {
        let result: GenerateResult;
        switch (provider) {
          case 'anthropic': result = await this.callAnthropic(creds, opts, maxTokens, temperature); break;
          case 'openai':    result = await this.callOpenAI(creds, opts, maxTokens, temperature); break;
          case 'gemini':    result = await this.callGemini(creds, opts, maxTokens, temperature); break;
          default: continue;
        }
        if (!result?.text?.trim()) {
          this.logger.warn(`[AI:${provider}] returned empty text${i < order.length - 1 ? ' — failing over to next provider' : ''}`);
          continue;
        }
        // Meter token consumption per user/day/provider (best-effort, never blocks).
        // Metered BEFORE the truncation check — a truncated draft consumed real tokens too.
        if (creds.user_id && result.tokens > 0) {
          void this.usage.record(
            creds.user_id, result.provider,
            result.promptTokens ?? 0, result.outputTokens ?? 0, result.tokens,
          );
        }
        if (opts.truncationFailover && result.truncated && i < order.length - 1) {
          truncatedFallback ??= result;
          this.logger.warn(`[AI:${provider}] draft truncated at the token budget — failing over to next provider`);
          continue;
        }
        return result;
      } catch (err: any) {
        const msg = err?.response?.data?.error?.message || err.message;
        this.logger.error(`[AI:${provider}] generation failed: ${msg}${i < order.length - 1 ? ' — failing over to next provider' : ''}`);
      }
    }
    // Every other provider errored, answered empty, or truncated too — hand the caller the
    // first truncated draft (still flagged) rather than nothing at all.
    return truncatedFallback;
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
          // The system prompt is the stable part (per campaign or global) and is re-sent for
          // every draft, retry and judge pass — see anthropic-cache.ts.
          system: cachedSystem(opts.system),
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
    const promptTokens = anthropicInputTokens(usage);
    const outputTokens = usage.output_tokens || 0;
    return {
      text, provider: 'anthropic', tokens: promptTokens + outputTokens, promptTokens, outputTokens,
      truncated: finishReasonTruncated(res.data?.stop_reason),
    };
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
    const u = res.data?.usage || {};
    const promptTokens = u.prompt_tokens || 0;
    const outputTokens = u.completion_tokens || 0;
    return {
      text, provider: 'openai', tokens: u.total_tokens || promptTokens + outputTokens, promptTokens, outputTokens,
      truncated: finishReasonTruncated(res.data?.choices?.[0]?.finish_reason),
    };
  }

  // ── Google Gemini ─────────────────────────────────────────────────────────

  private async callGemini(
    creds: DecryptedCredentials, opts: GenerateOptions, maxTokens: number, temperature: number,
  ): Promise<GenerateResult> {
    const model = creds.gemini_model || 'gemini-2.5-flash';
    // gemini-2.5-* are "thinking" models — reasoning tokens can otherwise eat the whole
    // output budget and truncate the post. flash / flash-lite allow disabling thinking
    // (budget 0); gemini-2.5-pro does NOT — it rejects budget 0 (min 128). This quirk is
    // specific to the 2.5 FAMILY: newer generations (3.x+) manage their own thinking and
    // may reject a forced budget outright — so only send thinkingConfig for 2.5 models,
    // and give newer models extra output headroom instead.
    const isPro = /pro/i.test(model);
    const legacy25 = /2\.5/.test(model);
    const generationConfig: Record<string, unknown> = {
      temperature,
      // Thinking allowance ON TOP of the caller's text budget — a flat floor swallowed
      // the caller's truncation-retry escalation (see gemini-budget.ts, issue #62).
      maxOutputTokens: geminiOutputBudget(model, maxTokens),
    };
    if (legacy25) generationConfig.thinkingConfig = { thinkingBudget: isPro ? 128 : 0 };
    const doCall = (cfg: Record<string, unknown>) =>
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
          generationConfig: cfg,
        },
        { headers: { 'Content-Type': 'application/json' }, timeout: 25_000 },
      );
    const res = await this.withRetry(() => doCall(generationConfig)).catch(async (err: any) => {
      // Defensive: if a model rejects thinkingConfig (INVALID_ARGUMENT mentioning
      // thinking), retry once without it rather than failing the whole generation.
      const msg = String(err?.response?.data?.error?.message || '');
      if (err?.response?.status === 400 && /think/i.test(msg) && generationConfig.thinkingConfig) {
        const { thinkingConfig: _drop, ...rest } = generationConfig;
        return this.withRetry(() => doCall(rest));
      }
      throw err;
    });
    // Join every text part (a response may be split across parts).
    const parts = res.data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p: any) => p?.text || '').join('').trim();
    const usage = res.data?.usageMetadata || {};
    const promptTokens = usage.promptTokenCount || 0;
    const outputTokens = usage.candidatesTokenCount || 0;
    return {
      text, provider: 'gemini',
      tokens: usage.totalTokenCount || promptTokens + outputTokens,
      promptTokens, outputTokens,
      truncated: finishReasonTruncated(res.data?.candidates?.[0]?.finishReason),
    };
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
