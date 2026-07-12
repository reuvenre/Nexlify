import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SupplierCatalog } from './entities/supplier-catalog.entity';
import { SupplierProduct } from './entities/supplier-product.entity';
import { YupooService } from './yupoo.service';
import { SupplierCatalogsService } from './supplier-catalogs.service';
import { SupplierProductsService } from './supplier-products.service';
import { SuppliersController } from './suppliers.controller';
import { SupplierImageController } from './supplier-image.controller';
import { PostsModule } from '../posts/posts.module';
import { AiModule } from '../ai/ai.module';
import { CredentialsModule } from '../credentials/credentials.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { RatesModule } from '../rates/rates.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SupplierCatalog, SupplierProduct]),
    PostsModule,
    AiModule,
    CredentialsModule,
    SubscriptionModule,
    RatesModule,
  ],
  providers: [YupooService, SupplierCatalogsService, SupplierProductsService],
  controllers: [SuppliersController, SupplierImageController],
  exports: [SupplierProductsService, YupooService],
})
export class SuppliersModule {}
