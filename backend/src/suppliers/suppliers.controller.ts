import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, Req, UseGuards, HttpCode,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SupplierCatalogsService } from './supplier-catalogs.service';
import { SupplierProductsService } from './supplier-products.service';

@Controller('suppliers')
@UseGuards(JwtAuthGuard)
export class SuppliersController {
  constructor(
    private readonly catalogs: SupplierCatalogsService,
    private readonly products: SupplierProductsService,
  ) {}

  private uid(req: Request): string { return (req.user as any).id; }

  // ── Catalogs ────────────────────────────────────────────────────────────
  @Get('catalogs')
  listCatalogs(@Req() req: Request) { return this.catalogs.list(this.uid(req)); }

  @Post('catalogs')
  @HttpCode(201)
  createCatalog(@Req() req: Request, @Body() dto: any) { return this.catalogs.create(this.uid(req), dto); }

  @Get('catalogs/probe')
  probe(@Req() req: Request, @Query('store') store: string) { return this.catalogs.probeStore(store); }

  @Patch('catalogs/:id')
  updateCatalog(@Req() req: Request, @Param('id') id: string, @Body() dto: any) {
    return this.catalogs.update(this.uid(req), id, dto);
  }

  @Delete('catalogs/:id')
  removeCatalog(@Req() req: Request, @Param('id') id: string) { return this.catalogs.remove(this.uid(req), id); }

  // ── Products ────────────────────────────────────────────────────────────
  @Get('products')
  listProducts(@Req() req: Request, @Query('catalog_id') catalogId?: string) {
    return this.products.list(this.uid(req), catalogId);
  }

  @Post('products/link')
  @HttpCode(201)
  link(@Req() req: Request, @Body() dto: { catalogId: string; yupooUrl: string; flylinkUrl: string; code?: string }) {
    return this.products.link(this.uid(req), dto);
  }

  @Patch('products/:id')
  updateProduct(@Req() req: Request, @Param('id') id: string, @Body() dto: any) {
    return this.products.update(this.uid(req), id, dto);
  }

  @Delete('products/:id')
  removeProduct(@Req() req: Request, @Param('id') id: string) { return this.products.remove(this.uid(req), id); }

  @Post('products/:id/generate-description')
  @HttpCode(200)
  genDesc(@Req() req: Request, @Param('id') id: string) {
    return this.products.generateDescription(this.uid(req), id);
  }

  @Post('products/:id/queue')
  @HttpCode(201)
  queue(@Req() req: Request, @Param('id') id: string, @Body('channel_id') channelId?: string) {
    return this.products.queue(this.uid(req), id, channelId);
  }
}
