import {
  Controller, Post, Get, Param, Body, Req, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrchestratorAgent } from './orchestrator.agent';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentRun } from './agent-run.entity';
import { CampaignsService } from '../campaigns/campaigns.service';

@Controller('agents')
@UseGuards(JwtAuthGuard)
export class AgentsController {
  constructor(
    private readonly orchestrator: OrchestratorAgent,
    private readonly campaigns: CampaignsService,
    @InjectRepository(AgentRun)
    private readonly runRepo: Repository<AgentRun>,
  ) {}

  /** Manually trigger the orchestrator for a specific campaign */
  @Post('run')
  async triggerRun(@Req() req: any, @Body() body: { campaign_id: string }) {
    const userId = req.user.id;
    const campaign = await this.campaigns.get(userId, body.campaign_id);
    return this.orchestrator.run(campaign as any, userId);
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
