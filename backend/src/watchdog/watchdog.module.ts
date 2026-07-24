import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Post } from '../posts/post.entity';
import { Campaign } from '../campaigns/campaign.entity';
import { User } from '../users/user.entity';
import { MailModule } from '../mail/mail.module';
import { CredentialsModule } from '../credentials/credentials.module';
import { WatchdogService } from './watchdog.service';

@Module({
  imports: [TypeOrmModule.forFeature([Post, Campaign, User]), MailModule, CredentialsModule],
  providers: [WatchdogService],
})
export class WatchdogModule {}
