import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Channel } from '../channels/channel.entity';
import { User } from '../users/user.entity';
import { Post } from '../posts/post.entity';
import { ProductsModule } from '../products/products.module';
import { PostsModule } from '../posts/posts.module';
import { CredentialsModule } from '../credentials/credentials.module';
import { OptimizerModule } from '../optimizer/optimizer.module';
import { LinksModule } from '../links/links.module';
import { ManagerModule } from '../manager/manager.module';
import { ShopperSearch } from './shopper-search.entity';
import { ChannelMessage } from './channel-message.entity';
import { TelegramBotService } from './telegram-bot.service';

// Channel/User are registered as REPOSITORIES rather than pulling in ChannelsModule +
// UsersModule: UsersModule imports WatchdogModule, which imports this module for the
// webhook — going through the service would close that circle.
//
// OptimizerModule is safe to import outright: its own tree (credentials, subscription,
// mail, products, earnings, ai, notifications, pinterest) reaches neither UsersModule nor
// WatchdogModule, so the morning report's buttons don't reopen that circle.
@Module({
  imports: [
    // Post / ChannelMessage: the members' search also looks through what the channel
    // already published — as the system sent it, and as the channel shows it.
    TypeOrmModule.forFeature([Channel, User, ShopperSearch, Post, ChannelMessage]),
    ProductsModule, PostsModule, CredentialsModule, OptimizerModule,
    // The manager agent (owner questions) and short links for the members' search.
    // Neither reaches UsersModule or WatchdogModule.
    ManagerModule, LinksModule,
  ],
  providers: [TelegramBotService],
  exports: [TelegramBotService],
})
export class TelegramBotModule {}
