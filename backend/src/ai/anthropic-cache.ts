/**
 * Prompt caching for Anthropic calls.
 *
 * A cached prefix is re-read at about a tenth of the input price, and writing it costs
 * about a quarter more than an ordinary read — so a breakpoint only pays when the SAME
 * prefix is sent again within ~5 minutes. Two places in this codebase do that:
 *
 * - The copy/judge/relevance system prompts in AiService: fixed per campaign or global,
 *   and sent once per draft, retry and judge pass while a run writes its posts. Only the
 *   SYSTEM block is marked — the user prompt carries this product's facts and would be a
 *   write that is never read.
 * - The agents' tool loops: each turn re-sends everything before it, product search
 *   results included. A top-level breakpoint moves forward with the conversation, so turn
 *   N+1 reads what turn N wrote.
 *
 * Below the model's minimum cacheable length the marker is silently ignored and nothing is
 * charged extra, so a short prompt is safe to mark.
 */
export const EPHEMERAL = { type: 'ephemeral' } as const;

/** A system prompt as a single cached text block. */
export function cachedSystem(text: string): Array<{ type: 'text'; text: string; cache_control: typeof EPHEMERAL }> {
  return [{ type: 'text', text, cache_control: EPHEMERAL }];
}

/**
 * All input tokens the request actually processed. With caching on, `input_tokens` is only
 * the part AFTER the last breakpoint; metering it alone would make every cached call look
 * almost free and hide the real volume from the owner's usage screen.
 */
export function anthropicInputTokens(usage: {
  input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
} | null | undefined): number {
  if (!usage) return 0;
  return (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
}
