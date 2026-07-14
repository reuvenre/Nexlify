import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Coupon } from './coupon.entity';
import { CouponsService } from './coupons.service';
import { CouponsController } from './coupons.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Coupon])],
  providers: [CouponsService],
  controllers: [CouponsController],
  exports: [CouponsService],
})
export class CouponsModule {}
