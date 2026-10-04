import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Anthropic from '@anthropic-ai/sdk';
import { Campaign } from '../campaigns/campaign.entity';
import { Post } from '../posts/post.entity';
import { AgentClient } from './agent-client.service';
import { anthropicInputTokens, EPHEMERAL } from '../ai/anthropic-cache';

export interface CampaignHealth {
  status: 'healthy' | 'degraded' | 'paused';
  action_taken: string | null;
  recommendation: string;
  tokens: number;
}

@Injectable()
export class CampaignAgent {
  private readonly logger = new Logger(CampaignAgent.name);

  constructor(
    @InjectRepository(Campaign)
    private readonly campaignRepo: Repository<Campaign>,
    @InjectRepository(Post)
    private readonly postRepo: Repository<Post>,
    private readonly agentClient: AgentClient,
  ) {}

  async evaluateAndOptimize(
    userId: string,
    campaignId: string,
  ): Promise<CampaignHealth> {
    const campaign = await this.campaignRepo.findOne({ where: { id: campaignId, user_id: userId } });
    if (!campaign) {
      return { status: 'paused', action_taken: null, recommendation: 'Campaign not found', tokens: 0 };
    }

    const tools: Anthropic.Tool[] = [
      {
        name: 'get_campaign_stats',
        description: 'Get recent post statistics for a campaign: total posts, sent count, failed count, failure rate, last run time.',
        input_schema: {
          type: 'object' as const,
          properties: {
            days: { type: 'number', description: 'How many days back to look (default 7)' },
          },
          required: [],
        },
      },
      {
        name: 'get_failed_posts',
        description: 'Get recent failed posts with their error messages to diagnose recurring issues.',
        input_schema: {
          type: 'object' as const,
          properties: {
            limit: { type: 'number', description: 'Number of failed posts to retrieve (default 5)' },
          },
          required: [],
        },
      },
      {
        name: 'update_campaign_keywords',
        description: 'Replace the campaign keywords with a new set when current keywords are underperforming.',
        input_schema: {
          type: 'object' as const,
          properties: {
            keywords: {
              type: 'array',
              items: { type: 'string' },
              description: 'New list of keywords for the campaign',
            },
            reason: { type: 'string', description: 'Brief reason for the keyword change' },
          },
          required: ['keywords', 'reason'],
        },
      },
      {
        name: 'pause_campaign',
        description: 'Pause the campaign if it has a critical failure rate or repeated errors.',
        input_schema: {
          type: 'object' as const,
          properties: {
            reason: { type: 'string', description: 'Brief reason for pausing' },
          },
          required: ['reason'],
        },
      },
    ];

    const systemPrompt = `You are a campaign optimization agent for a Telegram affiliate marketing platform.
Your job: evaluate campaign health and take ONE corrective action if needed.

Decision rules:
- failure_rate > 50% AND >5 total posts → pause the campaign, something is critically wrong
- failure_rate > 30% AND error contains "Telegram" or "credentials" → pause (credentials issue)
- 0 posts in last 7 days AND campaign is "active" → keywords may be stale, suggest refresh
- failure_rate < 20% → campaign is healthy, no action needed
- Always justify your decision with data from the stats

After analysis, respond with JSON:
{ "status": "healthy|degraded|paused", "action_taken": "description or null", "recommendation": "brief advice" }`;

    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: `Evaluate campaign "${campaign.name}" (ID: ${campaignId}).
Campaign status: ${campaign.status}
Last run: ${campaign.last_run_at ? campaign.last_run_at.toISOString() : 'never'}
Keywords: ${campaign.keywords.join(', ')}
Posts per run: ${campaign.posts_per_run}

Check the stats and failed posts, then decide if any corrective action is needed. Respond with the JSON format.`,
      },
    ];

    let totalTokens = 0;
    let health: CampaignHealth = {
      status: 'healthy',
      action_taken: null,
      recommendation: 'Campaign is running normally.',
      tokens: 0,
    };
    let iterCount = 0;
    const { client, model } = await this.agentClient.for(userId);

    while (iterCount < 5) {
      iterCount++;
      const response = await client.messages.create({
        model,
        max_tokens: 1024,
        system: systemPrompt,
        tools,
        messages,
        // Each turn re-sends the whole loop so far; this breakpoint moves with it, so the
        // next turn reads it from cache (anthropic-cache.ts).
        cache_control: EPHEMERAL,
      });

      totalTokens += anthropicInputTokens(response.usage) + response.usage.output_tokens;
      this.agentClient.record(userId, response.usage);

      if (response.stop_reason === 'tool_use') {
        const assistantMessage: Anthropic.MessageParam = { role: 'assistant', content: response.content };
        messages.push(assistantMessage);

        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;

          if (block.name === 'get_campaign_stats') {
            const days = (block.input as any).days || 7;
            const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
            try {
              const posts = await this.postRepo
                .createQueryBuilder('p')
                .where('p.campaign_id = :campaignId AND p.created_at >= :since', { campaignId, since })
                .getMany();

              const sent = posts.filter((p) => p.status === 'sent').length;
              const failed = posts.filter((p) => p.status === 'failed').length;
              const total = posts.length;
              const failureRate = total > 0 ? Math.round((failed / total) * 100) : 0;

              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: JSON.stringify({ total, sent, failed, failure_rate_pct: failureRate, days_lookback: days }),
              });
            } catch (err: any) {
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ error: err.message }) });
            }
          }

          if (block.name === 'get_failed_posts') {
            const limit = Math.min((block.input as any).limit || 5, 10);
            try {
              const failed = await this.postRepo
                .createQueryBuilder('p')
                .where('p.campaign_id = :campaignId AND p.status = :status', { campaignId, status: 'failed' })
                .orderBy('p.created_at', 'DESC')
                .take(limit)
                .getMany();

              const results = failed.map((p) => ({
                product_title: p.product_title,
                error: p.error_message,
                created_at: p.created_at,
              }));
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(results) });
            } catch (err: any) {
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ error: err.message }) });
            }
          }

          if (block.name === 'update_campaign_keywords') {
            const { keywords, reason } = block.input as any;
            try {
              await this.campaignRepo.update({ id: campaignId }, { keywords });
              this.logger.log(`CampaignAgent: updated keywords for ${campaignId} — ${reason}`);
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ success: true, new_keywords: keywords }) });
            } catch (err: any) {
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ error: err.message }) });
            }
          }

          if (block.name === 'pause_campaign') {
            const { reason } = block.input as any;
            try {
              await this.campaignRepo.update({ id: campaignId }, { status: 'paused' });
              this.logger.warn(`CampaignAgent: paused campaign ${campaignId} — ${reason}`);
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ success: true, paused: true }) });
            } catch (err: any) {
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ error: err.message }) });
            }
          }
        }

        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      // end_turn — parse JSON result
      const textBlock = response.content.find((b) => b.type === 'text');
      if (textBlock && textBlock.type === 'text') {
        const match = textBlock.text.match(/\{[\s\S]*\}/);
        if (match) {
          try {
            const parsed = JSON.parse(match[0]);
            health = {
              status: parsed.status || 'healthy',
              action_taken: parsed.action_taken ?? null,
              recommendation: parsed.recommendation || '',
              tokens: totalTokens,
            };
          } catch {
            this.logger.warn('CampaignAgent: failed to parse JSON response');
          }
        }
      }
      break;
    }

    health.tokens = totalTokens;
    return health;
  }
}
