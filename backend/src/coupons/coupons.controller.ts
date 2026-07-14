import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CouponsService } from './coupons.service';

@Controller('coupons')
@UseGuards(JwtAuthGuard)
export class CouponsController {
  constructor(private readonly svc: CouponsService) {}

  private uid(req: Request) { return (req.user as any).id; }

  @Get()
  list(@Req() req: Request) {
    return this.svc.list(this.uid(req));
  }

  /** Parse a pasted block WITHOUT saving — lets the UI show what was detected first. */
  @Post('preview')
  @HttpCode(200)
  preview(@Body('text') text: string) {
    return { coupons: this.svc.preview(text || '') };
  }

  /** Import a pasted coupon block. Re-importing the same code refreshes it. */
  @Post('import')
  @HttpCode(201)
  import(
    @Req() req: Request,
    @Body('text') text: string,
    @Body('campaign') campaign?: string,
    @Body('starts_at') startsAt?: string,
    @Body('ends_at') endsAt?: string,
  ) {
    return this.svc.importText(this.uid(req), text || '', { campaign, starts_at: startsAt, ends_at: endsAt });
  }

  /** Manually add/update one coupon — the fallback when AliExpress changes its wording. */
  @Post()
  @HttpCode(201)
  addOne(@Req() req: Request, @Body() dto: {
    code: string; discount_usd: number; min_spend_usd: number;
    campaign?: string; starts_at?: string; ends_at?: string;
  }) {
    return this.svc.upsertOne(this.uid(req), dto);
  }

  /** Which coupon a given product price would get — used for the live preview. */
  @Get('best')
  best(@Req() req: Request, @Query('price_usd') priceUsd: string) {
    return this.svc.bestFor(this.uid(req), Number(priceUsd) || 0).then((c) => ({ coupon: c }));
  }

  @Patch(':id')
  setActive(@Req() req: Request, @Param('id') id: string, @Body('is_active') isActive: boolean) {
    return this.svc.setActive(this.uid(req), id, isActive !== false);
  }

  @Delete(':id')
  @HttpCode(200)
  remove(@Req() req: Request, @Param('id') id: string) {
    return this.svc.remove(this.uid(req), id);
  }
}
