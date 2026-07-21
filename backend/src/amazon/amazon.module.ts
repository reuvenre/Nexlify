import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Campaign } from '../campaigns/campaign.entity';
import { AmazonService } from './amazon.service';
import { AmazonController } from './amazon.controller';
import { CredentialsModule } from '../credentials/credentials.module';
import { PostsModule } from '../posts/posts.module';

@Module({
  imports: [TypeOrmModule.forFeature([Campaign]), CredentialsModule, PostsModule],
  controllers: [AmazonController],
  providers: [AmazonService],
  exports: [AmazonService],
})
export class AmazonModule {}
