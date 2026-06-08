import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Anthropic from '@anthropic-ai/sdk';
import { AgentRun } from './agent-run.entity';
import { CodebaseInspectionService } from './codebase-inspection.service';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { AuditLogService } from '../audit/audit-log.service';

export interface SecurityScanResult {
  findings_count: number;
  recommendations_filed: number;
  summary: string;
  tokens: number;
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'run_dependency_audit',
    description: 'Run "npm audit" for the frontend or backend project and get a vulnerability severity summary plus raw report.',
    input_schema: {
      type: 'object' as const,
      properties: { target: { type: 'string', enum: ['frontend', 'backend'], description: 'Which project to audit' } },
      required: ['target'],
    },
  },
  {
    name: 'search_code',
    description: 'Search source files for a literal string/pattern (e.g. hardcoded secrets, raw SQL string concatenation, disabled auth guards).',
    input_schema: {
      type: 'object' as const,
      properties: {
        target: { type: 'string', enum: ['frontend', 'backend'], description: 'Which project to search' },
        query: { type: 'string', description: 'Text or pattern to search for' },
        path: { type: 'string', description: 'Subdirectory to search within (default "src")' },
      },
      required: ['target', 'query'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a source/config file to inspect auth, encryption, or permission setup.',
    input_schema: {
      type: 'object' as const,
      properties: {
        target: { type: 'string', enum: ['frontend', 'backend'], description: 'Which project the file belongs to' },
        path: { type: 'string', description: 'Relative file path' },
      },
      required: ['target', 'path'],
    },
  },
  {
    name: 'get_access_activity_summary',
    description: 'Get a count of recent authentication and access events for the user (logins, failed logins, credential access) to spot anomalies like brute-force attempts.',
    input_schema: {
      type: 'object' as const,
      properties: { days: { type: 'number', description: 'How many days back to look (default 7)' } },
      required: [],
    },
  },
];

const SYSTEM_PROMPT = `You are the Security Officer agent for AliBot-PRO, a NestJS + Next.js affiliate marketing platform that stores encrypted user credentials (AliExpress, Telegram, OpenAI keys) and uses JWT auth.

Your job each run — focus on three areas:
1. Code & dependency security: run dependency audits (npm audit) on both frontend and backend, and search the code for risky patterns (hardcoded secrets/API keys, string-concatenated SQL, disabled/missing auth guards, console.log of sensitive data, weak crypto usage).
2. Activity & access monitoring: check recent access activity for anomalies — repeated failed logins, unusual credential access patterns.
3. Configuration & permissions: read and review the auth guard, JWT strategy, and credentials/encryption service to confirm they follow secure patterns (guards on sensitive routes, AES-256 encryption at rest, no plaintext secret logging).

Only report concrete, verified findings — cite the exact file/line or audit output that supports each finding. Do not speculate about issues you haven't checked. Triage severity realistically: a known low-severity transitive dependency vuln is "low", an exposed secret or missing auth guard is "critical".

You NEVER modify files — you only produce findings for a human to review and act on.

When finished, respond with ONLY a JSON array (no prose) of findings:
[{ "title": "short title", "description": "what you found, why it matters, and the evidence (file/line or audit data)", "severity": "low|medium|high|critical", "file_path": "relative/path or null", "recommendation": "concrete remediation step" }]
If you find nothing actionable, respond with an empty array: []`;

@Injectable()
export class SecurityAgent {
  private readonly logger = new Logger(SecurityAgent.name);
  private readonly client: Anthropic;

  constructor(
    private readonly inspection: CodebaseInspectionService,
    private readonly recommendations: RecommendationsService,
    private readonly auditLog: AuditLogService,
    @InjectRepository(AgentRun)
    private readonly runRepo: Repository<AgentRun>,
  ) {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  async scan(userId: string): Promise<SecurityScanResult> {
    const run = this.runRepo.create({
      user_id: userId,
      campaign_id: null,
      agent_type: 'security',
      input: {},
      status: 'running',
    });
    await this.runRepo.save(run);

    try {
      const { findings, tokens } = await this.investigate(userId);

      let filed = 0;
      for (const finding of findings) {
        if (!finding?.title || !finding?.description) continue;
        await this.recommendations.create(userId, {
          agent_type: 'security',
          category: 'security',
          severity: finding.severity || 'medium',
          title: finding.title,
          description: finding.recommendation
            ? `${finding.description}\n\nRecommended action: ${finding.recommendation}`
            : finding.description,
          payload: { file_path: finding.file_path || null },
        });
        filed++;
      }

      const result: SecurityScanResult = {
        findings_count: findings.length,
        recommendations_filed: filed,
        summary: `Security scan complete: ${findings.length} finding(s), ${filed} filed for review.`,
        tokens,
      };

      run.status = 'completed';
      run.output = result;
      run.tokens_used = tokens;
      await this.runRepo.save(run);
      return result;
    } catch (err: any) {
      this.logger.error(`Security scan failed: ${err.message}`);
      run.status = 'failed';
      run.error_message = err.message;
      await this.runRepo.save(run);
      return { findings_count: 0, recommendations_filed: 0, summary: `Scan failed: ${err.message}`, tokens: 0 };
    }
  }

  private async investigate(userId: string): Promise<{ findings: any[]; tokens: number }> {
    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: 'Run a security review covering dependency vulnerabilities, risky code patterns, access activity anomalies, and auth/encryption configuration. Report your findings as a JSON array.',
      },
    ];

    let totalTokens = 0;
    let findings: any[] = [];
    let iterCount = 0;

    while (iterCount < 14) {
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
          toolResults.push(await this.runTool(block, userId));
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
            this.logger.warn('SecurityAgent: failed to parse findings JSON');
          }
        }
      }
      break;
    }

    return { findings, tokens: totalTokens };
  }

  private async runTool(block: Anthropic.ToolUseBlock, userId: string): Promise<Anthropic.ToolResultBlockParam> {
    const input = block.input as any;
    try {
      let content: string;
      switch (block.name) {
        case 'run_dependency_audit':
          content = JSON.stringify(await this.inspection.runDependencyAudit(input.target));
          break;
        case 'search_code':
          content = await this.inspection.searchCode(input.target, input.query, input.path);
          break;
        case 'read_file':
          content = await this.inspection.readFile(input.target, input.path);
          break;
        case 'get_access_activity_summary': {
          const days = input.days || 7;
          const counts = await this.auditLog.countByEventType(userId, days);
          content = JSON.stringify({ days_lookback: days, event_counts: counts });
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
