import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Anthropic from '@anthropic-ai/sdk';
import { AgentRun } from './agent-run.entity';
import { CampaignsService } from '../campaigns/campaigns.service';
import { EarningsService } from '../earnings/earnings.service';
import { RecommendationsService } from '../recommendations/recommendations.service';

export interface SiteManagerResult {
  recommendations_filed: number;
  summary: string;
  tokens: number;
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_campaigns_overview',
    description: 'Get a list of the user\'s campaigns with status, keyword count, posts created, and last run time.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'get_earnings_overview',
    description: 'Get an earnings summary (estimated/settled/cancelled commission, breakdown by campaign and month) for a period.',
    input_schema: {
      type: 'object' as const,
      properties: { period: { type: 'string', enum: ['7d', '30d', '90d', 'all'], description: 'Lookback period (default 30d)' } },
      required: [],
    },
  },
  {
    name: 'get_open_recommendations',
    description: 'Get currently pending recommendations from the other agents (architects, security, etc.) so you can factor open issues into your strategy.',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: { type: 'string', description: 'Filter by category: strategy|code_change|security|campaign_action (optional)' },
      },
      required: [],
    },
  },
  {
    name: 'propose_campaign_action',
    description: 'File a recommendation to take a concrete action on a specific campaign (pause, resume, or update its keywords). Requires human approval before it is applied.',
    input_schema: {
      type: 'object' as const,
      properties: {
        campaign_id: { type: 'string', description: 'ID of the campaign' },
        action: { type: 'string', enum: ['pause', 'resume', 'update_keywords'], description: 'Action to propose' },
        keywords: { type: 'array', items: { type: 'string' }, description: 'New keywords (only for update_keywords)' },
        title: { type: 'string', description: 'Short title for the recommendation' },
        reasoning: { type: 'string', description: 'Why you recommend this action, citing the data you reviewed' },
        severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'How urgent this is' },
      },
      required: ['campaign_id', 'action', 'title', 'reasoning'],
    },
  },
  {
    name: 'propose_strategy',
    description: 'File a general strategic recommendation that is not a direct campaign action (e.g. budget allocation, new campaign ideas, prioritization advice).',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Short title for the recommendation' },
        description: { type: 'string', description: 'The strategic recommendation and the data/reasoning behind it' },
        severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'How important this is' },
      },
      required: ['title', 'description'],
    },
  },
];

const SYSTEM_PROMPT = `You are the Site Manager agent for AliBot-PRO — an affiliate marketing automation platform that runs Telegram campaigns promoting AliExpress products via a multi-agent system (product discovery, content writing, posting, campaign health, frontend/backend architecture, security).

Your job: review the overall state of the business each run — campaign performance, earnings trends, and open issues flagged by the other agents — and produce STRATEGIC recommendations for the human operator.

You make NO changes yourself. Every recommendation you file (campaign actions or general strategy) waits for human approval:
- Campaign actions (pause/resume/update keywords) are applied automatically once approved.
- Strategic recommendations are advisory only — the human decides what to do with them.

Decision guidance:
- A campaign with high failure rate, declining earnings, or stale keywords (no posts in days) deserves a concrete propose_campaign_action.
- Cross-cutting concerns (e.g. multiple campaigns underperforming, recurring security findings, budget allocation across campaigns by ROI) deserve a propose_strategy.
- Always tie your recommendation to specific numbers you retrieved — never recommend based on vague impressions.
- Don't flood the operator: only file recommendations that are genuinely actionable and well-supported. If everything looks healthy, file nothing and say so.

Use your tools to gather data, file recommendations via propose_campaign_action / propose_strategy as you go, then finish with a short plain-text summary of what you reviewed and what (if anything) you recommended.`;

@Injectable()
export class SiteManagerAgent {
  private readonly logger = new Logger(SiteManagerAgent.name);
  private readonly client: Anthropic;

  constructor(
    private readonly campaigns: CampaignsService,
    private readonly earnings: EarningsService,
    private readonly recommendations: RecommendationsService,
    @InjectRepository(AgentRun)
    private readonly runRepo: Repository<AgentRun>,
  ) {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  async review(userId: string): Promise<SiteManagerResult> {
    const run = this.runRepo.create({
      user_id: userId,
      campaign_id: null,
      agent_type: 'site_manager',
      input: {},
      status: 'running',
    });
    await this.runRepo.save(run);

    try {
      const { filed, summary, tokens } = await this.investigate(userId);

      const result: SiteManagerResult = {
        recommendations_filed: filed,
        summary,
        tokens,
      };

      run.status = 'completed';
      run.output = result;
      run.tokens_used = tokens;
      await this.runRepo.save(run);
      return result;
    } catch (err: any) {
      this.logger.error(`Site manager review failed: ${err.message}`);
      run.status = 'failed';
      run.error_message = err.message;
      await this.runRepo.save(run);
      return { recommendations_filed: 0, summary: `Review failed: ${err.message}`, tokens: 0 };
    }
  }

  private async investigate(userId: string): Promise<{ filed: number; summary: string; tokens: number }> {
    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: 'Review the current state of the business (campaigns, earnings, open issues from other agents) and file any well-supported strategic recommendations. Finish with a short plain-text summary.',
      },
    ];

    let totalTokens = 0;
    let filed = 0;
    let summary = '';
    let iterCount = 0;

    while (iterCount < 12) {
      iterCount++;
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 3072,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
      });

      totalTokens += response.usage.input_tokens + response.usage.output_tokens;

      if (response.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: response.content });
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;
          const { result, filedOne } = await this.runTool(block, userId);
          if (filedOne) filed++;
          toolResults.push(result);
        }

        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      const textBlock = response.content.find((b) => b.type === 'text');
      if (textBlock && textBlock.type === 'text') {
        summary = textBlock.text.trim();
      }
      break;
    }

    if (!summary) {
      summary = filed > 0
        ? `Filed ${filed} recommendation(s) for review.`
        : 'Reviewed campaigns and earnings — no actionable recommendations at this time.';
    }

    return { filed, summary, tokens: totalTokens };
  }

  private async runTool(
    block: Anthropic.ToolUseBlock,
    userId: string,
  ): Promise<{ result: Anthropic.ToolResultBlockParam; filedOne: boolean }> {
    const input = block.input as any;
    let filedOne = false;
    try {
      let content: string;
      switch (block.name) {
        case 'get_campaigns_overview': {
          const { data } = await this.campaigns.list(userId, 1, 50);
          content = JSON.stringify(data.map((c) => ({
            id: c.id,
            name: c.name,
            status: c.status,
            keywords: c.keywords,
            posts_count: c.posts_count,
            last_run_at: c.last_run_at,
            use_agents: c.use_agents,
          })));
          break;
        }

        case 'get_earnings_overview': {
          const period = (input.period || '30d') as '7d' | '30d' | '90d' | 'all';
          content = JSON.stringify(await this.earnings.summary(userId, period));
          break;
        }

        case 'get_open_recommendations': {
          const list = await this.recommendations.list(userId, { status: 'pending', category: input.category });
          content = JSON.stringify(list.map((r) => ({
            id: r.id, agent_type: r.agent_type, category: r.category, severity: r.severity, title: r.title,
          })));
          break;
        }

        case 'propose_campaign_action': {
          const { campaign_id, action, keywords, title, reasoning, severity } = input;
          const rec = await this.recommendations.create(userId, {
            agent_type: 'site_manager',
            category: 'campaign_action',
            severity: severity || 'medium',
            title,
            description: reasoning,
            payload: { action, campaign_id, params: action === 'update_keywords' ? { keywords } : undefined },
          });
          filedOne = true;
          content = JSON.stringify({ filed: true, recommendation_id: rec.id });
          break;
        }

        case 'propose_strategy': {
          const { title, description, severity } = input;
          const rec = await this.recommendations.create(userId, {
            agent_type: 'site_manager',
            category: 'strategy',
            severity: severity || 'medium',
            title,
            description,
          });
          filedOne = true;
          content = JSON.stringify({ filed: true, recommendation_id: rec.id });
          break;
        }

        default:
          content = JSON.stringify({ error: `Unknown tool ${block.name}` });
      }
      return { result: { type: 'tool_result', tool_use_id: block.id, content }, filedOne };
    } catch (err: any) {
      return {
        result: { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ error: err.message }), is_error: true },
        filedOne,
      };
    }
  }
}
