import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiService } from './ai.service';
import { AiUsage } from './ai-usage.entity';
import { AiUsageService } from './ai-usage.service';
import { AiUsageController } from './ai-usage.controller';
import { CredentialsModule } from '../credentials/credentials.module';

@Module({
  imports: [TypeOrmModule.forFeature([AiUsage]), CredentialsModule],
  providers: [AiService, AiUsageService],
  controllers: [AiUsageController],
  exports: [AiService, AiUsageService],
})
export class AiModule {}
