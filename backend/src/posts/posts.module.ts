import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Post } from './post.entity';
import { Template } from '../templates/template.entity';
import { PostsService } from './posts.service';
import { PostsController } from './posts.controller';
import { CredentialsModule } from '../credentials/credentials.module';
import { RatesModule } from '../rates/rates.module';
import { AiModule } from '../ai/ai.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { ChannelsModule } from '../channels/channels.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Post, Template]),
    CredentialsModule,
    RatesModule,
    AiModule,
    SubscriptionModule,
    ChannelsModule,
  ],
  providers: [PostsService],
  controllers: [PostsController],
  exports: [PostsService],
})
export class PostsModule {}
