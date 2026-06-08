import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AgentRecommendation,
  RecommendationAgentType,
  RecommendationCategory,
  RecommendationSeverity,
} from './recommendation.entity';
import { CampaignsService } from '../campaigns/campaigns.service';

export interface CreateRecommendationInput {
  agent_type: RecommendationAgentType;
  category: RecommendationCategory;
  severity?: RecommendationSeverity;
  title: string;
  description: string;
  payload?: Record<string, any>;
}

@Injectable()
export class RecommendationsService {
  private readonly logger = new Logger(RecommendationsService.name);

  constructor(
    @InjectRepository(AgentRecommendation)
    private readonly repo: Repository<AgentRecommendation>,
    private readonly campaigns: CampaignsService,
  ) {}

  /** Used by agents to file a new recommendation awaiting human review. */
  async create(userId: string, input: CreateRecommendationInput): Promise<AgentRecommendation> {
    const rec = this.repo.create({
      user_id: userId,
      agent_type: input.agent_type,
      category: input.category,
      severity: input.severity || 'medium',
      title: input.title,
      description: input.description,
      payload: input.payload || null,
      status: 'pending',
    });
    return this.repo.save(rec);
  }

  async list(userId: string, filters: { status?: string; agent_type?: string; category?: string } = {}) {
    const qb = this.repo.createQueryBuilder('r').where('r.user_id = :userId', { userId });
    if (filters.status) qb.andWhere('r.status = :status', { status: filters.status });
    if (filters.agent_type) qb.andWhere('r.agent_type = :agentType', { agentType: filters.agent_type });
    if (filters.category) qb.andWhere('r.category = :category', { category: filters.category });
    return qb.orderBy('r.created_at', 'DESC').take(100).getMany();
  }

  async get(userId: string, id: string): Promise<AgentRecommendation> {
    const rec = await this.repo.findOne({ where: { id, user_id: userId } });
    if (!rec) throw new NotFoundException('Recommendation not found');
    return rec;
  }

  async approve(userId: string, id: string, note?: string): Promise<AgentRecommendation> {
    const rec = await this.get(userId, id);
    rec.status = 'approved';
    rec.reviewed_at = new Date();
    rec.review_note = note || null;
    await this.repo.save(rec);

    // campaign_action recommendations are executed immediately on approval —
    // everything else (code_change, security, strategy) just becomes "approved"
    // and is applied manually by the developer/operator.
    if (rec.category === 'campaign_action' && rec.payload?.campaign_id) {
      try {
        await this.applyCampaignAction(userId, rec);
        rec.status = 'applied';
        await this.repo.save(rec);
      } catch (err: any) {
        this.logger.error(`Failed to apply campaign action for recommendation ${rec.id}: ${err.message}`);
      }
    }

    return rec;
  }

  async reject(userId: string, id: string, note?: string): Promise<AgentRecommendation> {
    const rec = await this.get(userId, id);
    rec.status = 'rejected';
    rec.reviewed_at = new Date();
    rec.review_note = note || null;
    return this.repo.save(rec);
  }

  private async applyCampaignAction(userId: string, rec: AgentRecommendation) {
    const { action, campaign_id, params } = rec.payload as { action: string; campaign_id: string; params?: any };
    switch (action) {
      case 'pause':
        await this.campaigns.pause(userId, campaign_id);
        break;
      case 'resume':
        await this.campaigns.resume(userId, campaign_id);
        break;
      case 'update_keywords':
        await this.campaigns.update(userId, campaign_id, { keywords: params?.keywords });
        break;
      default:
        throw new Error(`Unknown campaign action: ${action}`);
    }
    this.logger.log(`Applied campaign action "${action}" for campaign ${campaign_id} (recommendation ${rec.id})`);
  }
}
