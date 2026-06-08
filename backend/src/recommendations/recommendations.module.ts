import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentRecommendation } from './recommendation.entity';
import { RecommendationsService } from './recommendations.service';
import { RecommendationsController } from './recommendations.controller';
import { CampaignsModule } from '../campaigns/campaigns.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AgentRecommendation]),
    CampaignsModule,
  ],
  providers: [RecommendationsService],
  controllers: [RecommendationsController],
  exports: [RecommendationsService],
})
export class RecommendationsModule {}
