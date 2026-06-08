import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { UsersService } from '../users/users.service';
import { SiteManagerAgent } from '../agents/site-manager.agent';
import { FrontendArchitectAgent } from '../agents/frontend-architect.agent';
import { BackendArchitectAgent } from '../agents/backend-architect.agent';
import { SecurityAgent } from '../agents/security.agent';

/**
 * Schedules the "meta" agents that watch over the platform itself rather than
 * a specific campaign: strategic review, codebase health, and security.
 * They run once per registered user (each user owns their own campaigns/data),
 * staggered with a short delay so they don't all hit the Anthropic API at once.
 */
@Injectable()
export class SystemAgentsSchedulerService {
  private readonly logger = new Logger(SystemAgentsSchedulerService.name);
  private running = new Set<string>();

  constructor(
    private readonly users: UsersService,
    private readonly siteManager: SiteManagerAgent,
    private readonly frontendArchitect: FrontendArchitectAgent,
    private readonly backendArchitect: BackendArchitectAgent,
    private readonly security: SecurityAgent,
  ) {}

  /** Site Manager strategic review — once a day at 08:00 */
  @Cron('0 0 8 * * *')
  async runSiteManagerDaily() {
    await this.forEachUser('site-manager', (userId) => this.siteManager.review(userId));
  }

  /** Security scan — once a day at 03:00 (off-peak) */
  @Cron('0 0 3 * * *')
  async runSecurityDaily() {
    await this.forEachUser('security', (userId) => this.security.scan(userId));
  }

  /** Frontend architecture review — weekly, Monday 04:00 */
  @Cron('0 0 4 * * 1')
  async runFrontendArchitectWeekly() {
    await this.forEachUser('frontend-architect', (userId) => this.frontendArchitect.review(userId));
  }

  /** Backend architecture review — weekly, Monday 04:30 */
  @Cron('0 30 4 * * 1')
  async runBackendArchitectWeekly() {
    await this.forEachUser('backend-architect', (userId) => this.backendArchitect.review(userId));
  }

  private async forEachUser(label: string, run: (userId: string) => Promise<unknown>) {
    const key = label;
    if (this.running.has(key)) {
      this.logger.warn(`${label}: previous run still in progress — skipping this tick`);
      return;
    }
    this.running.add(key);
    try {
      const userIds = await this.users.findAllIds();
      for (const userId of userIds) {
        try {
          await run(userId);
        } catch (err: any) {
          this.logger.error(`${label} failed for user ${userId}: ${err.message}`);
        }
        // Small stagger to avoid bursting the Anthropic API across many users.
        await new Promise((r) => setTimeout(r, 2000));
      }
    } catch (err: any) {
      this.logger.error(`${label} tick failed: ${err.message}`);
    } finally {
      this.running.delete(key);
    }
  }
}
