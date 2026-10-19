import {
  BadRequestException, Controller, Get, Post, Patch, Delete, Body, Param, Query, Req,
  UseGuards, HttpCode, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PostsService } from './posts.service';
import { normalizeUploadedImage } from './uploaded-image.util';

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
    @Query('source') source?: string,
    @Query('platform') platform?: string,
  ) {
    // Cap the page size so a client can't request an arbitrarily large page.
    const safeLimit = Math.min(100, Math.max(1, +limit || 20));
    return this.svc.list(this.uid(req), +page, safeLimit, status, campaignId, source, platform);
  }

  @Post('preview')
  @HttpCode(200)
  preview(
    @Req() req: Request,
    @Body('product_id') productId: string,
    @Body('language') language?: string,
    @Body('custom_product') customProduct?: any,
    @Body('template') template?: string,
    @Body('promo') promo?: { discount?: number | null; ends_at?: string | null },
    @Body('hint') hint?: string,
  ) {
    return this.svc.preview(this.uid(req), productId, language, customProduct, template, undefined, hint, false, promo);
  }

  /** Bulk import from the owner's product file — rows are parsed client-side, sent in
   *  batches (short-link resolution is slow), composed from the file's own copy, queued. */
  @Post('import')
  @HttpCode(200)
  importRows(@Req() req: Request, @Body() body: { rows?: any[]; channels?: string[] }) {
    return this.svc.importCustomPosts(this.uid(req), body?.rows || [], body?.channels);
  }

  /** One-image AI-redesign preview (Nano Banana) — see the style before enabling it. */
  @Post('enhance-preview')
  @HttpCode(200)
  enhancePreview(@Req() req: Request, @Body('image_url') imageUrl?: string) {
    return this.svc.enhancePreview(this.uid(req), imageUrl);
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
    @Body('product') product?: any,
    @Body('channels') channels?: string[],
    @Body('promo') promo?: { is_promo?: boolean; ends_at?: string | null; discount?: number | null },
    @Body('images') images?: string[],
  ) {
    return this.svc.schedulePost(
      this.uid(req), productId, new Date(scheduledAt),
      text, channelOverride, productImage, affiliateUrlOverride, product, channels, promo, images,
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
    @Body('product') product?: any,
    @Body('channels') channels?: string[],
    @Body('promo') promo?: { is_promo?: boolean; ends_at?: string | null; discount?: number | null },
  ) {
    return this.svc.quickPost(
      this.uid(req), productId, text, channelOverride, productImage, affiliateUrlOverride, product, channels, promo,
    );
  }

  @Post(':id/retry')
  @HttpCode(200)
  retry(@Req() req: Request, @Param('id') id: string) {
    return this.svc.retry(this.uid(req), id);
  }

  /** Regenerate the copy from the editor's CURRENT fields — vision-grounded in the
   *  post's actual photo(s), with the edited title as the authoritative identity. */
  @Post(':id/regenerate')
  @HttpCode(200)
  regenerate(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { title?: string; price_ils?: number; image_url?: string; language?: string },
  ) {
    return this.svc.regenerateForPost(this.uid(req), id, body || {});
  }

  /** Re-send only the platform(s) that failed on a partially-published post. */
  @Post(':id/retry-failed')
  @HttpCode(200)
  retryFailed(@Req() req: Request, @Param('id') id: string) {
    return this.svc.retryFailedChannels(this.uid(req), id);
  }

  /** Re-publish a post through the queue (no time) or schedule it (with time). */
  /**
   * Smart link intake: paste a product URL → keyword + best-fitting campaign + a post
   * scheduled through that campaign's routing. AI_TIMEOUT-scale work (link resolution,
   * product fetch, judge, copywriting) — the client sets its timeout accordingly.
   */
  /**
   * Owner image upload for the post editor — phone gallery / computer file. Normalized
   * (EXIF rotation, size cap, JPEG) before storage; returns the public URL every platform
   * can ingest. The 8MB limit is the raw upload; storage weighs a few hundred KB.
   */
  @Post('upload-image')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  async uploadImage(
    @Req() req: Request,
    @UploadedFile() file: { buffer: Buffer; mimetype: string } | undefined,
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('לא התקבל קובץ תמונה');
    if (!/^image\//.test(file.mimetype || '')) throw new BadRequestException('הקובץ אינו תמונה');
    let normalized: Buffer;
    try {
      normalized = await normalizeUploadedImage(file.buffer);
    } catch {
      throw new BadRequestException('קובץ התמונה לא נקרא — נסה JPG/PNG אחר');
    }
    return this.svc.saveUploadedImage(this.uid(req), normalized);
  }

  /** Which group a hand-picked product belongs to, and its automatic post's template (product-routing.ts). */
  @Post('route')
  @HttpCode(200)
  route(
    @Req() req: Request,
    @Body('product_id') productId: string,
    @Body('title') title?: string,
    @Body('category') category?: string,
    @Body('keyword') keyword?: string,
    @Body('channel_id') channelId?: string,
  ) {
    if (!productId) throw new BadRequestException('חסר מזהה מוצר');
    return this.svc.routeProduct(this.uid(req), {
      product_id: String(productId).slice(0, 40),
      title: title ? String(title).slice(0, 300) : undefined,
      category: category ? String(category).slice(0, 120) : undefined,
      keyword: keyword ? String(keyword).slice(0, 80) : undefined,
      channel_id: channelId ? String(channelId).slice(0, 64) : undefined,
    });
  }

  @Post('smart-intake')
  @HttpCode(200)
  smartIntake(
    @Req() req: Request,
    @Body('url') url: string,
    @Body('campaign_id') campaignId?: string,
    @Body('campaign_ids') campaignIds?: string[],
    @Body('to_queue') toQueue?: boolean,
  ) {
    return this.svc.smartIntake(this.uid(req), url, {
      campaignId: campaignId || undefined,
      // More than one pick → one post through EACH chosen campaign's routing.
      campaignIds: Array.isArray(campaignIds)
        ? campaignIds.filter((c) => typeof c === 'string' && c.trim()).slice(0, 10)
        : undefined,
      toQueue: toQueue === true,
    });
  }

  @Post(':id/requeue')
  @HttpCode(200)
  requeue(
    @Req() req: Request,
    @Param('id') id: string,
    @Body('scheduled_at') scheduledAt?: string,
    @Body('channels') channels?: string[],
    @Body('platforms') platforms?: string[],
  ) {
    return this.svc.requeue(this.uid(req), id, scheduledAt, channels, platforms);
  }

  /**
   * Push an existing post to specific platform(s) + group(s) — no re-charge, no duplicate
   * to platforms/groups you didn't pick. Back-fill old posts to Facebook / a missed group.
   */
  @Post(':id/push')
  @HttpCode(200)
  push(
    @Req() req: Request,
    @Param('id') id: string,
    @Body('platforms') platforms: string[],
    @Body('channels') channels?: string[],
    @Body('pinterest_rewrite') pinterestRewrite?: boolean,
  ) {
    return this.svc.pushToPlatforms(this.uid(req), id, platforms, channels, {
      pinterestRewrite: pinterestRewrite === true,
    });
  }

  /** Pin this post as the template FLYLINK re-posts clone for its product (copy + images). */
  @Post(':id/repost-source')
  @HttpCode(200)
  setRepostSource(@Req() req: Request, @Param('id') id: string) {
    return this.svc.setRepostSource(this.uid(req), id);
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
    @Body('channels') channels?: string[],
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
    }, text, channels);
  }

  @Delete('queue/:id')
  @HttpCode(200)
  dequeue(@Req() req: Request, @Param('id') id: string) {
    return this.svc.dequeue(this.uid(req), id);
  }

  /** Edit a post's text and/or scheduled time (from the posts management screen). */
  @Patch(':id')
  updatePost(@Req() req: Request, @Param('id') id: string, @Body() dto: {
    text?: string; scheduled_at?: string;
    product_title?: string; price_ils?: number; product_image?: string; affiliate_url?: string;
    gallery?: string[];
    /** Re-target the post to other group(s); [] = back to the default channel. */
    channels?: string[];
  }) {
    return this.svc.updatePost(this.uid(req), id, dto);
  }

  /** Delete any post (queued/scheduled/sent/failed) from the posts management screen. */
  @Delete(':id')
  @HttpCode(200)
  removePost(@Req() req: Request, @Param('id') id: string) {
    return this.svc.deletePost(this.uid(req), id);
  }
}
