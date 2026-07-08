import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { CredentialsModule } from '../credentials/credentials.module';
import { RatesModule } from '../rates/rates.module';
import { PricingModule } from '../pricing/pricing.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [CredentialsModule, RatesModule, PricingModule, AiModule],
  providers: [ProductsService],
  controllers: [ProductsController],
  exports: [ProductsService],
})
export class ProductsModule {}
