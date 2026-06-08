import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentRun } from './agent-run.entity';
import { ProductAgent } from './product.agent';
import { ContentAgent } from './content.agent';
import { CampaignAgent } from './campaign.agent';
import { OrchestratorAgent } from './orchestrator.agent';
import { SiteManagerAgent } from './site-manager.agent';
import { FrontendArchitectAgent } from './frontend-architect.agent';
import { BackendArchitectAgent } from './backend-architect.agent';
import { SecurityAgent } from './security.agent';
import { CodebaseInspectionService } from './codebase-inspection.service';
import { AgentsController } from './agents.controller';
import { PostsModule } from '../posts/posts.module';
import { ProductsModule } from '../products/products.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { CredentialsModule } from '../credentials/credentials.module';
import { RatesModule } from '../rates/rates.module';
import { EarningsModule } from '../earnings/earnings.module';
import { RecommendationsModule } from '../recommendations/recommendations.module';
import { AuditLogModule } from '../audit/audit-log.module';
import { Post } from '../posts/post.entity';
import { Campaign } from '../campaigns/campaign.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([AgentRun, Post, Campaign]),
    PostsModule,
    ProductsModule,
    CampaignsModule,
    CredentialsModule,
    RatesModule,
    EarningsModule,
    RecommendationsModule,
    AuditLogModule,
  ],
  providers: [
    ProductAgent,
    ContentAgent,
    CampaignAgent,
    OrchestratorAgent,
    SiteManagerAgent,
    FrontendArchitectAgent,
    BackendArchitectAgent,
    SecurityAgent,
    CodebaseInspectionService,
  ],
  controllers: [AgentsController],
  exports: [OrchestratorAgent, SiteManagerAgent, FrontendArchitectAgent, BackendArchitectAgent, SecurityAgent],
})
export class AgentsModule {}
