import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Earning } from '../earnings/earning.entity';
import { LinkClick } from '../links/link-click.entity';
import { Post } from '../posts/post.entity';
import { Campaign } from '../campaigns/campaign.entity';
import { RatesModule } from '../rates/rates.module';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

@Module({
  imports: [TypeOrmModule.forFeature([Earning, LinkClick, Post, Campaign]), RatesModule],
  controllers: [StatsController],
  providers: [StatsService],
  exports: [StatsService],
})
export class StatsModule {}
