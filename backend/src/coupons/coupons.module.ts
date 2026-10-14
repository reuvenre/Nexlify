import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Coupon } from './coupon.entity';
import { CouponsService } from './coupons.service';
import { CouponsController } from './coupons.controller';
import { AiModule } from '../ai/ai.module';
import { CredentialsModule } from '../credentials/credentials.module';
import { LinksModule } from '../links/links.module';
import { RatesModule } from '../rates/rates.module';
import { CustomPost } from '../custom-posts/custom-post.entity';
import { Campaign } from '../campaigns/campaign.entity';
import { Post } from '../posts/post.entity';
import { User } from '../users/user.entity';
import { SaleReadinessService } from './sale-readiness.service';

@Module({
  // CustomPost/Campaign/Post are repo-only registrations (no service imports) — pulling
  // CustomPostsModule in here would close the Posts → Coupons → CustomPosts → Posts cycle.
  imports: [TypeOrmModule.forFeature([Coupon, CustomPost, Campaign, Post, User]), AiModule, CredentialsModule, LinksModule, RatesModule],
  providers: [CouponsService, SaleReadinessService],
  controllers: [CouponsController],
  exports: [CouponsService, SaleReadinessService],
})
export class CouponsModule {}
