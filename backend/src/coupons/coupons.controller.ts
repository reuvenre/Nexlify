import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CouponsService } from './coupons.service';
import { CredentialsService } from '../credentials/credentials.service';

@Controller('coupons')
@UseGuards(JwtAuthGuard)
export class CouponsController {
  constructor(
    private readonly svc: CouponsService,
    private readonly credentials: CredentialsService,
  ) {}

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

  /**
   * AI fallback for wording the regex can't parse. Costs one AI generation, so it's a
   * separate on-demand call rather than part of the live preview. Still returns only
   * schema-validated rows.
   */
  @Post('preview-ai')
  @HttpCode(200)
  async previewAi(@Req() req: Request, @Body('text') text: string) {
    const creds = await this.credentials.getRaw(this.uid(req));
    return { coupons: await this.svc.parseWithAi(creds, text || '') };
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
  async best(@Req() req: Request, @Query('price_usd') priceUsd: string) {
    const match = await this.svc.bestFor(this.uid(req), Number(priceUsd) || 0);
    return {
      coupon: match?.coupon ?? null,
      // false = the price is below every tier, so this is the "add another item" nudge.
      qualifies: match?.qualifies ?? false,
      line: match ? this.svc.couponLine(match.coupon, match.qualifies) : null,
    };
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
