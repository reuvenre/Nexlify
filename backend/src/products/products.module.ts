import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Campaign } from '../campaigns/campaign.entity';
import { Earning } from '../earnings/earning.entity';
import { Post } from '../posts/post.entity';
import { CommissionScoutService } from './commission-scout.service';
import { CommissionScoutController } from './commission-scout.controller';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { CredentialsModule } from '../credentials/credentials.module';
import { RatesModule } from '../rates/rates.module';
import { PricingModule } from '../pricing/pricing.module';
import { AiModule } from '../ai/ai.module';

@Module({
  // Campaign / Post: the commission scout reads the active keywords and what was posted.
  imports: [CredentialsModule, RatesModule, PricingModule, AiModule, TypeOrmModule.forFeature([Campaign, Post, Earning])],
  providers: [ProductsService, CommissionScoutService],
  controllers: [ProductsController, CommissionScoutController],
  exports: [ProductsService, CommissionScoutService],
})
export class ProductsModule {}
