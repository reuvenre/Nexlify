import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentRun } from './agent-run.entity';
import { ProductAgent } from './product.agent';
import { ContentAgent } from './content.agent';
import { CampaignAgent } from './campaign.agent';
import { OrchestratorAgent } from './orchestrator.agent';
import { AgentsController } from './agents.controller';
import { PostsModule } from '../posts/posts.module';
import { ProductsModule } from '../products/products.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { CredentialsModule } from '../credentials/credentials.module';
import { RatesModule } from '../rates/rates.module';
import { AiModule } from '../ai/ai.module';
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
    AiModule,
  ],
  providers: [
    ProductAgent,
    ContentAgent,
    CampaignAgent,
    OrchestratorAgent,
  ],
  controllers: [AgentsController],
  exports: [OrchestratorAgent],
})
export class AgentsModule {}
