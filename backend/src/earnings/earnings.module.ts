import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Earning } from './earning.entity';
import { EarningsService } from './earnings.service';
import { EarningsController } from './earnings.controller';
import { CredentialsModule } from '../credentials/credentials.module';
import { RatesModule } from '../rates/rates.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Earning]),
    CredentialsModule,
    RatesModule,
  ],
  providers: [EarningsService],
  controllers: [EarningsController],
  exports: [EarningsService],
})
export class EarningsModule {}
