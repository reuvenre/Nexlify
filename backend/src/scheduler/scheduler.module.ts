import { Module } from '@nestjs/common';
import { CampaignSchedulerService } from './campaign-scheduler.service';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { PostsModule } from '../posts/posts.module';
import { CredentialsModule } from '../credentials/credentials.module';
import { ChannelsModule } from '../channels/channels.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AgentsModule } from '../agents/agents.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { EarningsModule } from '../earnings/earnings.module';

@Module({
  imports: [CampaignsModule, PostsModule, CredentialsModule, ChannelsModule, NotificationsModule, AgentsModule, SuppliersModule, EarningsModule],
  providers: [CampaignSchedulerService],
})
export class SchedulerModule {}
