import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Promotion } from './promotion.entity';
import { PromotionsService } from './promotions.service';
import { AdminPromotionsController, PromotionsController } from './promotions.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Promotion])],
  providers: [PromotionsService],
  controllers: [PromotionsController, AdminPromotionsController],
  exports: [PromotionsService],
})
export class PromotionsModule {}
