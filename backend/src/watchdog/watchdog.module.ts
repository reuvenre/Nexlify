import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Post } from '../posts/post.entity';
import { Campaign } from '../campaigns/campaign.entity';
import { User } from '../users/user.entity';
import { MailModule } from '../mail/mail.module';
import { CredentialsModule } from '../credentials/credentials.module';
import { WatchdogService } from './watchdog.service';
import { SecurityModule } from '../security/security.module';

@Module({
  imports: [TypeOrmModule.forFeature([Post, Campaign, User]), MailModule, CredentialsModule, SecurityModule],
  providers: [WatchdogService],
  exports: [WatchdogService],
})
export class WatchdogModule {}
