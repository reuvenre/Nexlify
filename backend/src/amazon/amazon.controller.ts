import { Controller, Get, Post, Query, Req, UseGuards, HttpCode } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AmazonService } from './amazon.service';

@Controller('amazon')
@UseGuards(JwtAuthGuard)
export class AmazonController {
  constructor(private readonly svc: AmazonService) {}

  /** Verify the account's Amazon PA-API credentials with a minimal live SearchItems call. */
  @Post('test')
  @HttpCode(200)
  test(@Req() req: Request) {
    return this.svc.testConnection((req.user as any).id);
  }

  /** Search Amazon products by keyword (returns normalized products with the affiliate link). */
  @Get('search')
  search(
    @Req() req: Request,
    @Query('keyword') keyword = '',
    @Query('min_price') minPrice?: string,
    @Query('max_price') maxPrice?: string,
  ) {
    return this.svc.searchItems((req.user as any).id, keyword, {
      minPrice: minPrice ? +minPrice : undefined,
      maxPrice: maxPrice ? +maxPrice : undefined,
    });
  }
}
