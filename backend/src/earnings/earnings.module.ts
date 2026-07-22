import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Earning } from './earning.entity';
import { Post } from '../posts/post.entity';
import { Campaign } from '../campaigns/campaign.entity';
import { EarningsService } from './earnings.service';
import { EarningsController } from './earnings.controller';
import { CredentialsModule } from '../credentials/credentials.module';
import { RatesModule } from '../rates/rates.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Earning, Post, Campaign]),
    CredentialsModule,
    RatesModule,
  ],
  providers: [EarningsService],
  controllers: [EarningsController],
  exports: [EarningsService],
})
export class EarningsModule {}
