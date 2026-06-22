import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdBoost } from './ad-boost.entity';
import { Post } from '../posts/post.entity';
import { AdsService } from './ads.service';
import { AdsController } from './ads.controller';
import { CredentialsModule } from '../credentials/credentials.module';
import { RatesModule } from '../rates/rates.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AdBoost, Post]),
    CredentialsModule,
    RatesModule,
  ],
  providers: [AdsService],
  controllers: [AdsController],
  exports: [AdsService],
})
export class AdsModule {}
