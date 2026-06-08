import {
  Controller, Post, Get, Param, Body, Req, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlanGuard } from '../auth/plan.guard';
import { RequiresPlan } from '../auth/plan.decorator';
import { OrchestratorAgent } from './orchestrator.agent';
import { SiteManagerAgent } from './site-manager.agent';
import { FrontendArchitectAgent } from './frontend-architect.agent';
import { BackendArchitectAgent } from './backend-architect.agent';
import { SecurityAgent } from './security.agent';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentRun } from './agent-run.entity';
import { CampaignsService } from '../campaigns/campaigns.service';

@Controller('agents')
@UseGuards(JwtAuthGuard)
export class AgentsController {
  constructor(
    private readonly orchestrator: OrchestratorAgent,
    private readonly siteManager: SiteManagerAgent,
    private readonly frontendArchitect: FrontendArchitectAgent,
    private readonly backendArchitect: BackendArchitectAgent,
    private readonly security: SecurityAgent,
    private readonly campaigns: CampaignsService,
    @InjectRepository(AgentRun)
    private readonly runRepo: Repository<AgentRun>,
  ) {}

  /** Manually trigger the orchestrator for a specific campaign — premium AI feature, requires Growth plan or higher (admins bypass) */
  @Post('run')
  @UseGuards(PlanGuard)
  @RequiresPlan('growth')
  async triggerRun(@Req() req: any, @Body() body: { campaign_id: string }) {
    const userId = req.user.id;
    const campaign = await this.campaigns.get(userId, body.campaign_id);
    return this.orchestrator.run(campaign as any, userId);
  }

  /** Manually trigger the Site Manager strategic review — premium AI feature, requires Growth plan or higher (admins bypass) */
  @Post('site-manager/run')
  @UseGuards(PlanGuard)
  @RequiresPlan('growth')
  async runSiteManager(@Req() req: any) {
    return this.siteManager.review(req.user.id);
  }

  /** Manually trigger a Frontend Architect codebase review — premium AI feature, requires Growth plan or higher (admins bypass) */
  @Post('frontend-architect/run')
  @UseGuards(PlanGuard)
  @RequiresPlan('growth')
  async runFrontendArchitect(@Req() req: any) {
    return this.frontendArchitect.review(req.user.id);
  }

  /** Manually trigger a Backend Architect codebase review — premium AI feature, requires Growth plan or higher (admins bypass) */
  @Post('backend-architect/run')
  @UseGuards(PlanGuard)
  @RequiresPlan('growth')
  async runBackendArchitect(@Req() req: any) {
    return this.backendArchitect.review(req.user.id);
  }

  /** Manually trigger a Security Officer scan — premium AI feature, requires Growth plan or higher (admins bypass) */
  @Post('security/run')
  @UseGuards(PlanGuard)
  @RequiresPlan('growth')
  async runSecurityScan(@Req() req: any) {
    return this.security.scan(req.user.id);
  }

  /** List recent agent runs for the authenticated user */
  @Get('runs')
  async listRuns(@Req() req: any) {
    const userId = req.user.id;
    return this.runRepo.find({
      where: { user_id: userId },
      order: { created_at: 'DESC' },
      take: 50,
    });
  }

  /** Get a specific agent run by ID */
  @Get('runs/:id')
  async getRun(@Req() req: any, @Param('id') id: string) {
    const userId = req.user.id;
    return this.runRepo.findOne({ where: { id, user_id: userId } });
  }
}
