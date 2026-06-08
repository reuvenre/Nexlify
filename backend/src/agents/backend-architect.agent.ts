import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Anthropic from '@anthropic-ai/sdk';
import { AgentRun } from './agent-run.entity';
import { CodebaseInspectionService } from './codebase-inspection.service';
import { RecommendationsService } from '../recommendations/recommendations.service';

export interface ArchitectReviewResult {
  findings_count: number;
  recommendations_filed: number;
  summary: string;
  tokens: number;
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_directory',
    description: 'List files and subdirectories at a path relative to the backend project root (e.g. "src/agents").',
    input_schema: {
      type: 'object' as const,
      properties: { path: { type: 'string', description: 'Relative path (default ".")' } },
      required: [],
    },
  },
  {
    name: 'read_file',
    description: 'Read the full text content of a source file, given its path relative to the backend project root.',
    input_schema: {
      type: 'object' as const,
      properties: { path: { type: 'string', description: 'Relative file path, e.g. "src/posts/posts.service.ts"' } },
      required: ['path'],
    },
  },
  {
    name: 'search_code',
    description: 'Search for a literal string across .ts source files and get matching file:line results.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Text to search for' },
        path: { type: 'string', description: 'Subdirectory to search within (default "src")' },
      },
      required: ['query'],
    },
  },
  {
    name: 'run_typecheck',
    description: 'Run the TypeScript compiler in --noEmit mode and get any type errors.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'run_tests',
    description: 'Run the Jest test suite ("npm test") and get the results summary.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
];

const SYSTEM_PROMPT = `You are the Backend Architect agent for AliBot-PRO, a NestJS + TypeORM + PostgreSQL API.

Your job each run:
1. Investigate the codebase using your read-only tools (list_directory, read_file, search_code, run_typecheck, run_tests).
2. Look for real, concrete issues: type errors, failing tests, modules that deviate from the documented pattern (entity → service → controller → module → exported Service), missing JwtAuthGuard on routes that should be protected, N+1 query patterns, services bypassing the encryption/credentials layer, missing error handling at system boundaries, or duplicated business logic that should live in a shared service.
3. For each real issue you find, propose a concrete fix as a small unified diff against the affected file(s).

You NEVER modify files yourself, run database migrations, or execute git commands — you only produce proposals for a human developer to review and apply manually. Be conservative: only report issues you've actually verified by reading the code or tool output, not speculation.

When finished, respond with ONLY a JSON array (no prose) of findings:
[{ "title": "short title", "description": "what's wrong and why it matters", "severity": "low|medium|high", "file_path": "relative/path.ts", "diff": "unified diff string or null if no concrete fix" }]
If you find nothing actionable, respond with an empty array: []`;

@Injectable()
export class BackendArchitectAgent {
  private readonly logger = new Logger(BackendArchitectAgent.name);
  private readonly client: Anthropic;

  constructor(
    private readonly inspection: CodebaseInspectionService,
    private readonly recommendations: RecommendationsService,
    @InjectRepository(AgentRun)
    private readonly runRepo: Repository<AgentRun>,
  ) {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  async review(userId: string): Promise<ArchitectReviewResult> {
    const run = this.runRepo.create({
      user_id: userId,
      campaign_id: null,
      agent_type: 'backend_architect',
      input: {},
      status: 'running',
    });
    await this.runRepo.save(run);

    try {
      const { findings, tokens } = await this.investigate();

      let filed = 0;
      for (const finding of findings) {
        if (!finding?.title || !finding?.description) continue;
        await this.recommendations.create(userId, {
          agent_type: 'backend_architect',
          category: 'code_change',
          severity: finding.severity || 'medium',
          title: finding.title,
          description: finding.description,
          payload: { target: 'backend', file_path: finding.file_path || null, diff: finding.diff || null },
        });
        filed++;
      }

      const result: ArchitectReviewResult = {
        findings_count: findings.length,
        recommendations_filed: filed,
        summary: `Reviewed backend codebase: ${findings.length} finding(s), ${filed} filed for review.`,
        tokens,
      };

      run.status = 'completed';
      run.output = result;
      run.tokens_used = tokens;
      await this.runRepo.save(run);
      return result;
    } catch (err: any) {
      this.logger.error(`Backend architect review failed: ${err.message}`);
      run.status = 'failed';
      run.error_message = err.message;
      await this.runRepo.save(run);
      return { findings_count: 0, recommendations_filed: 0, summary: `Review failed: ${err.message}`, tokens: 0 };
    }
  }

  private async investigate(): Promise<{ findings: any[]; tokens: number }> {
    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: 'Review the backend codebase for real architectural and code-quality issues, then report your findings as a JSON array.',
      },
    ];

    let totalTokens = 0;
    let findings: any[] = [];
    let iterCount = 0;

    while (iterCount < 12) {
      iterCount++;
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
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
          toolResults.push(await this.runTool(block));
        }

        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      const textBlock = response.content.find((b) => b.type === 'text');
      if (textBlock && textBlock.type === 'text') {
        const match = textBlock.text.match(/\[[\s\S]*\]/);
        if (match) {
          try {
            findings = JSON.parse(match[0]);
          } catch {
            this.logger.warn('BackendArchitectAgent: failed to parse findings JSON');
          }
        }
      }
      break;
    }

    return { findings, tokens: totalTokens };
  }

  private async runTool(block: Anthropic.ToolUseBlock): Promise<Anthropic.ToolResultBlockParam> {
    const input = block.input as any;
    try {
      let content: string;
      switch (block.name) {
        case 'list_directory':
          content = JSON.stringify(await this.inspection.listDirectory('backend', input.path));
          break;
        case 'read_file':
          content = await this.inspection.readFile('backend', input.path);
          break;
        case 'search_code':
          content = await this.inspection.searchCode('backend', input.query, input.path);
          break;
        case 'run_typecheck': {
          const r = await this.inspection.runCheck('backend', 'typecheck');
          content = JSON.stringify(r);
          break;
        }
        case 'run_tests': {
          const r = await this.inspection.runCheck('backend', 'test');
          content = JSON.stringify(r);
          break;
        }
        default:
          content = JSON.stringify({ error: `Unknown tool ${block.name}` });
      }
      return { type: 'tool_result', tool_use_id: block.id, content };
    } catch (err: any) {
      return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ error: err.message }), is_error: true };
    }
  }
}
