import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Campaign } from '../campaigns/campaign.entity';
import { CredentialsModule } from '../credentials/credentials.module';
import { AiModule } from '../ai/ai.module';
import { AgentClient } from '../agents/agent-client.service';
import { ManagerAgentService } from './manager-agent.service';

// Own AgentClient instance rather than importing AgentsModule: that module pulls in the
// whole campaign runner, and the manager only needs a metered Anthropic client.
@Module({
  imports: [TypeOrmModule.forFeature([Campaign]), CredentialsModule, AiModule],
  providers: [AgentClient, ManagerAgentService],
  // AgentClient too: the readers' search bot rewrites searches with it (telegram-bot/query-rewrite.ts).
  exports: [ManagerAgentService, AgentClient],
})
export class ManagerModule {}
