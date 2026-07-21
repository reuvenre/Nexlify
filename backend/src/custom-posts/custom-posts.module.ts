import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomPost } from './custom-post.entity';
import { CustomPostsService } from './custom-posts.service';
import { CustomPostsController } from './custom-posts.controller';
import { PostsModule } from '../posts/posts.module';

@Module({
  imports: [TypeOrmModule.forFeature([CustomPost]), PostsModule],
  controllers: [CustomPostsController],
  providers: [CustomPostsService],
})
export class CustomPostsModule {}
