import { Module } from '@nestjs/common';
import { CampaignSchedulerService } from './campaign-scheduler.service';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { PostsModule } from '../posts/posts.module';
import { CredentialsModule } from '../credentials/credentials.module';
import { ChannelsModule } from '../channels/channels.module';
import { AgentsModule } from '../agents/agents.module';
import { AdsModule } from '../ads/ads.module';
import { SuppliersModule } from '../suppliers/suppliers.module';

@Module({
  imports: [CampaignsModule, PostsModule, CredentialsModule, ChannelsModule, AgentsModule, AdsModule, SuppliersModule],
  providers: [CampaignSchedulerService],
})
export class SchedulerModule {}
