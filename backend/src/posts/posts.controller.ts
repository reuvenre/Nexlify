import {
  Controller, Get, Post, Delete, Body, Param, Query, Req, UseGuards, HttpCode,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PostsService } from './posts.service';

@Controller('posts')
@UseGuards(JwtAuthGuard)
export class PostsController {
  constructor(private readonly svc: PostsService) {}

  private uid(req: Request) { return (req.user as any).id; }

  @Get()
  list(
    @Req() req: Request,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('status') status?: string,
    @Query('campaign_id') campaignId?: string,
  ) {
    return this.svc.list(this.uid(req), +page, +limit, status, campaignId);
  }

  @Post('preview')
  @HttpCode(200)
  preview(
    @Req() req: Request,
    @Body('product_id') productId: string,
    @Body('language') language?: string,
    @Body('custom_product') customProduct?: any,
    @Body('template') template?: string,
  ) {
    return this.svc.preview(this.uid(req), productId, language, customProduct, template);
  }

  @Post('schedule')
  schedulePost(
    @Req() req: Request,
    @Body('product_id') productId: string,
    @Body('scheduled_at') scheduledAt: string,
    @Body('text') text?: string,
    @Body('channel_override') channelOverride?: string,
    @Body('product_image') productImage?: string,
    @Body('affiliate_url') affiliateUrlOverride?: string,
  ) {
    return this.svc.schedulePost(
      this.uid(req), productId, new Date(scheduledAt),
      text, channelOverride, productImage, affiliateUrlOverride,
    );
  }

  @Post('quick')
  quickPost(
    @Req() req: Request,
    @Body('product_id') productId: string,
    @Body('text') text?: string,
    @Body('channel_override') channelOverride?: string,
    @Body('product_image') productImage?: string,
    @Body('affiliate_url') affiliateUrlOverride?: string,
  ) {
    return this.svc.quickPost(
      this.uid(req), productId, text, channelOverride, productImage, affiliateUrlOverride,
    );
  }

  @Post(':id/retry')
  @HttpCode(200)
  retry(@Req() req: Request, @Param('id') id: string) {
    return this.svc.retry(this.uid(req), id);
  }

  // ── Queue ──────────────────────────────────────────────────────────────────

  @Get('queue')
  listQueue(@Req() req: Request) {
    return this.svc.listQueue(this.uid(req));
  }

  /** One-click add-to-queue: send time is decided by the user's schedule settings. */
  @Post('queue')
  @HttpCode(201)
  addToQueue(
    @Req() req: Request,
    @Body('product') product: any,
    @Body('text') text?: string,
  ) {
    return this.svc.addToQueue(this.uid(req), {
      product_id: String(product?.product_id ?? ''),
      title: product?.title ?? '',
      image_url: product?.image_url ?? '',
      affiliate_url: product?.affiliate_url ?? '',
      sale_price: Number(product?.sale_price) || 0,
      original_price: Number(product?.original_price) || 0,
      // Empty string → service fills the user's target currency (NOT USD, which would
      // mis-convert an already-₪ price).
      currency: product?.currency ?? '',
      discount_percent: Number(product?.discount_percent) || 0,
      orders_count: Number(product?.orders_count) || 0,
      rating: Number(product?.rating) || 0,
    }, text);
  }

  @Delete('queue/:id')
  @HttpCode(200)
  dequeue(@Req() req: Request, @Param('id') id: string) {
    return this.svc.dequeue(this.uid(req), id);
  }
}
