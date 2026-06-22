import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogProduct } from '../catalog/catalog-product.entity';
import { DiscoveryService } from './discovery.service';
import { DiscoveryController } from './discovery.controller';
import { CredentialsModule } from '../credentials/credentials.module';
import { RatesModule } from '../rates/rates.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CatalogProduct]),
    CredentialsModule,
    RatesModule,
  ],
  providers: [DiscoveryService],
  controllers: [DiscoveryController],
  exports: [DiscoveryService],
})
export class DiscoveryModule {}
