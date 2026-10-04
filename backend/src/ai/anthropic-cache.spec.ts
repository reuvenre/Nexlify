import axios from 'axios';
import { AiService } from './ai.service';
import { anthropicInputTokens, cachedSystem } from './anthropic-cache';

describe('anthropic prompt caching', () => {
  it('marks the system prompt as one cached block', () => {
    expect(cachedSystem('rules')).toEqual([{ type: 'text', text: 'rules', cache_control: { type: 'ephemeral' } }]);
  });

  it('meters cached and freshly cached input along with the uncached tail', () => {
    expect(anthropicInputTokens({ input_tokens: 40, cache_read_input_tokens: 1800, cache_creation_input_tokens: 0 })).toBe(1840);
    expect(anthropicInputTokens({ input_tokens: 40, cache_read_input_tokens: null, cache_creation_input_tokens: 1800 })).toBe(1840);
    expect(anthropicInputTokens({ input_tokens: 12 })).toBe(12);
    expect(anthropicInputTokens(undefined)).toBe(0);
  });

  it('AiService caches the system block only — the per-product prompt stays uncached — and meters the full input', async () => {
    const post = jest.spyOn(axios, 'post').mockResolvedValue({
      data: {
        content: [{ type: 'text', text: 'copy' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 50, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0, output_tokens: 30 },
      },
    } as any);
    const svc = new AiService({ record: jest.fn() } as any);
    const res = await (svc as any).callAnthropic({ anthropic_api_key: 'k' }, { system: 'SYS', prompt: 'product facts' }, 400, 0.7);
    const body = post.mock.calls[0][1] as any;
    expect(body.system).toEqual([{ type: 'text', text: 'SYS', cache_control: { type: 'ephemeral' } }]);
    expect(body.messages[0].content).toBe('product facts');
    expect(body.cache_control).toBeUndefined();
    expect(res).toMatchObject({ promptTokens: 2050, outputTokens: 30, tokens: 2080 });
    post.mockRestore();
  });
});
