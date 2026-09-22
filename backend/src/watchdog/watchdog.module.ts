import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Post } from '../posts/post.entity';
import { Campaign } from '../campaigns/campaign.entity';
import { User } from '../users/user.entity';
import { MailModule } from '../mail/mail.module';
import { CredentialsModule } from '../credentials/credentials.module';
import { WatchdogService } from './watchdog.service';
import { WatchdogMemory } from './watchdog-memory.entity';
import { WatchdogMemoryStore } from './watchdog-memory.store';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { SecurityModule } from '../security/security.module';
import { ChannelsModule } from '../channels/channels.module';
import { TelegramBotModule } from '../telegram-bot/telegram-bot.module';

@Module({
  imports: [TypeOrmModule.forFeature([Post, Campaign, User, WatchdogMemory]), MailModule, CredentialsModule, SecurityModule, ChannelsModule, TelegramBotModule],
  providers: [WatchdogService, WatchdogMemoryStore],
  controllers: [TelegramWebhookController],
  exports: [WatchdogService],
})
export class WatchdogModule {}
