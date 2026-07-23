import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Campaign } from './campaign.entity';
import { CampaignsService } from './campaigns.service';
import { CampaignsController } from './campaigns.controller';
import { PostsModule } from '../posts/posts.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { AmazonModule } from '../amazon/amazon.module';
import { SubscriptionModule } from '../subscription/subscription.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Campaign]),
    PostsModule,
    // For FLYLINK campaigns, which run through SupplierProductsService. No cycle:
    // SuppliersModule imports PostsModule, not CampaignsModule.
    SuppliersModule,
    // For Amazon campaigns, which run through AmazonService. No cycle: AmazonModule imports
    // PostsModule + the Campaign repo, not CampaignsModule.
    AmazonModule,
    SubscriptionModule,
  ],
  providers: [CampaignsService],
  controllers: [CampaignsController],
  exports: [CampaignsService],
})
export class CampaignsModule {}
