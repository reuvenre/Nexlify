import {
  Controller, Get, Post, Put, Delete, Patch, Body, Param,
  Query, Req, UseGuards, HttpCode,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CatalogService } from './catalog.service';

@Controller('catalog')
@UseGuards(JwtAuthGuard)
export class CatalogController {
  constructor(private readonly svc: CatalogService) {}

  private uid(req: Request): string { return (req.user as any).id; }

  // ── List ──────────────────────────────────────────────────────────────────

  @Get()
  list(
    @Req() req: Request,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('status') status?: string,
    @Query('has_post') hasPost?: string,
    @Query('search') search?: string,
  ) {
    const hp = hasPost === 'true' ? true : hasPost === 'false' ? false : undefined;
    return this.svc.list(this.uid(req), +page, +limit, status, hp, search);
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  @Get('stats')
  stats(@Req() req: Request) {
    return this.svc.stats(this.uid(req));
  }

  // NOTE: must be declared BEFORE @Get(':id') or the ':id' route swallows it.
  @Get('resync-status')
  resyncStatus(@Req() req: Request) {
    return this.svc.resyncStatus(this.uid(req));
  }

  // ── Import ────────────────────────────────────────────────────────────────

  @Post('import')
  @HttpCode(201)
  importProduct(
    @Req() req: Request,
    @Body('url') url?: string,
    @Body('product_id') productId?: string,
    @Body('category') category?: string,
    @Body('title') title?: string,
    @Body('image_url') imageUrl?: string,
    @Body('sale_price') salePrice?: number,
    @Body('original_price') originalPrice?: number,
    @Body('currency') currency?: string,
    @Body('discount_percent') discountPercent?: number,
    @Body('orders_count') ordersCount?: number,
    @Body('rating') rating?: number,
  ) {
    return this.svc.importProduct(this.uid(req), {
      url, productId, category,
      prefetched: title ? {
        title, imageUrl, salePrice, originalPrice, currency,
        discountPercent, ordersCount, rating,
      } : undefined,
    });
  }

  /** Bulk-import from a parsed CSV: [{ productId, category? }, …]. */
  @Post('import/bulk')
  @HttpCode(200)
  bulkImport(
    @Req() req: Request,
    @Body('rows') rows?: { productId?: string; product_id?: string; category?: string }[],
  ) {
    const normalized = (Array.isArray(rows) ? rows : [])
      .map((r) => ({ productId: String(r.productId ?? r.product_id ?? '').trim(), category: r.category }))
      .filter((r) => r.productId);
    return this.svc.bulkImport(this.uid(req), normalized);
  }

  // ── Get one ───────────────────────────────────────────────────────────────

  @Get(':id')
  findOne(@Req() req: Request, @Param('id') id: string) {
    return this.svc.findOne(this.uid(req), id);
  }

  // ── Update ────────────────────────────────────────────────────────────────

  @Put(':id')
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: any,
  ) {
    return this.svc.update(this.uid(req), id, dto);
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  @Delete(':id')
  remove(@Req() req: Request, @Param('id') id: string) {
    return this.svc.remove(this.uid(req), id);
  }

  // ── Approve ───────────────────────────────────────────────────────────────

  @Patch(':id/approve')
  @HttpCode(200)
  approve(@Req() req: Request, @Param('id') id: string) {
    return this.svc.setStatus(this.uid(req), id, 'approved');
  }

  // ── Reject ────────────────────────────────────────────────────────────────

  @Patch(':id/reject')
  @HttpCode(200)
  reject(@Req() req: Request, @Param('id') id: string) {
    return this.svc.setStatus(this.uid(req), id, 'rejected');
  }

  // ── Sync ──────────────────────────────────────────────────────────────────

  @Post(':id/sync')
  @HttpCode(200)
  sync(@Req() req: Request, @Param('id') id: string) {
    return this.svc.sync(this.uid(req), id);
  }

  // ── AI description ────────────────────────────────────────────────────────

  @Post(':id/generate-description')
  @HttpCode(200)
  generateDescription(@Req() req: Request, @Param('id') id: string) {
    return this.svc.generateDescription(this.uid(req), id);
  }

  // ── Bulk re-price (background job + progress polling) ────────────────────

  @Post('resync-prices')
  @HttpCode(200)
  resyncPrices(@Req() req: Request) {
    return this.svc.startResyncPrices(this.uid(req));
  }


  // ── Affiliate link ────────────────────────────────────────────────────────

  @Post(':id/affiliate-link')
  @HttpCode(200)
  affiliateLink(@Req() req: Request, @Param('id') id: string) {
    return this.svc.affiliateLink(this.uid(req), id);
  }

  // ── Queue product ─────────────────────────────────────────────────────────

  @Post(':id/queue')
  @HttpCode(201)
  queueProduct(@Req() req: Request, @Param('id') id: string) {
    return this.svc.queueProduct(this.uid(req), id);
  }

  // ── Queue batch ───────────────────────────────────────────────────────────

  @Post('queue-batch')
  @HttpCode(200)
  queueBatch(@Req() req: Request, @Body('ids') ids: string[]) {
    return this.svc.queueBatch(this.uid(req), ids);
  }
}
