import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Post } from '../posts/post.entity';
import { Campaign } from '../campaigns/campaign.entity';
import { User } from '../users/user.entity';
import { MailModule } from '../mail/mail.module';
import { CredentialsModule } from '../credentials/credentials.module';
import { WatchdogService } from './watchdog.service';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { SecurityModule } from '../security/security.module';
import { ChannelsModule } from '../channels/channels.module';
import { TelegramBotModule } from '../telegram-bot/telegram-bot.module';

// PersistentValueStore arrives from the global PersistentValueModule — it is infrastructure
// the watchdog's cross-deploy memory depends on, not a thing the watchdog owns.
@Module({
  imports: [TypeOrmModule.forFeature([Post, Campaign, User]), MailModule, CredentialsModule, SecurityModule, ChannelsModule, TelegramBotModule],
  providers: [WatchdogService],
  controllers: [TelegramWebhookController],
  exports: [WatchdogService],
})
export class WatchdogModule {}
