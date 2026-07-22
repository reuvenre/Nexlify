import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Post } from '../posts/post.entity';
import { CredentialsModule } from '../credentials/credentials.module';
import { PinterestService } from './pinterest.service';
import { PinterestController } from './pinterest.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Post]), CredentialsModule],
  providers: [PinterestService],
  controllers: [PinterestController],
  exports: [PinterestService],
})
export class PinterestModule {}
