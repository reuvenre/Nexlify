import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Post } from './post.entity';
import { Template } from '../templates/template.entity';
import { Campaign } from '../campaigns/campaign.entity';
import { PostsService } from './posts.service';
import { PostsController } from './posts.controller';
import { CredentialsModule } from '../credentials/credentials.module';
import { CouponsModule } from '../coupons/coupons.module';
import { RatesModule } from '../rates/rates.module';
import { AiModule } from '../ai/ai.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { ChannelsModule } from '../channels/channels.module';
import { CollageModule } from '../collage/collage.module';

@Module({
  imports: [
    // Campaign is registered as a REPOSITORY (not CampaignsService) on purpose:
    // CampaignsModule already imports PostsModule, so injecting the service back
    // would close a circular dependency.
    TypeOrmModule.forFeature([Post, Template, Campaign]),
    CredentialsModule,
    CouponsModule,
    RatesModule,
    AiModule,
    SubscriptionModule,
    ChannelsModule,
    CollageModule,
  ],
  providers: [PostsService],
  controllers: [PostsController],
  exports: [PostsService],
})
export class PostsModule {}
