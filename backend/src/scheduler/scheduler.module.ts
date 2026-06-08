import { Module } from '@nestjs/common';
import { CampaignSchedulerService } from './campaign-scheduler.service';
import { SystemAgentsSchedulerService } from './system-agents-scheduler.service';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { PostsModule } from '../posts/posts.module';
import { CredentialsModule } from '../credentials/credentials.module';
import { UsersModule } from '../users/users.module';
import { AgentsModule } from '../agents/agents.module';

@Module({
  imports: [CampaignsModule, PostsModule, CredentialsModule, UsersModule, AgentsModule],
  providers: [CampaignSchedulerService, SystemAgentsSchedulerService],
})
export class SchedulerModule {}
