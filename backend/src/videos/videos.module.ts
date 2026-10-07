import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VideoJob } from './video-job.entity';
import { Post } from '../posts/post.entity';
import { PostsModule } from '../posts/posts.module';
import { ChannelsModule } from '../channels/channels.module';
import { CredentialsModule } from '../credentials/credentials.module';
import { VideosService } from './videos.service';
import { VideosController } from './videos.controller';

@Module({
  imports: [TypeOrmModule.forFeature([VideoJob, Post]), PostsModule, ChannelsModule, CredentialsModule],
  providers: [VideosService],
  controllers: [VideosController],
  exports: [VideosService],
})
export class VideosModule {}
