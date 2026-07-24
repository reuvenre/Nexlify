import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity';
import { UsersService } from './users.service';
import { AdminController } from './admin.controller';
import { SubscriptionModule } from '../subscription/subscription.module';
import { MailModule } from '../mail/mail.module';
import { ChannelsModule } from '../channels/channels.module';
import { CredentialsModule } from '../credentials/credentials.module';
import { WatchdogModule } from '../watchdog/watchdog.module';

@Module({
  imports: [TypeOrmModule.forFeature([User]), SubscriptionModule, MailModule, ChannelsModule, CredentialsModule, WatchdogModule],
  providers: [UsersService],
  controllers: [AdminController],
  exports: [UsersService],
})
export class UsersModule {}
