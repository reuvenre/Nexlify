import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CommissionScoutService } from './commission-scout.service';

/** The high-commission screen (/commissions): the last scan, and "scan now". */
@Controller('commission-scout')
@UseGuards(JwtAuthGuard)
export class CommissionScoutController {
  constructor(private readonly scout: CommissionScoutService) {}

  @Get()
  catalog(@Req() req: Request) {
    return this.scout.catalog((req.user as any).id);
  }

  @Post('scan')
  scan(@Req() req: Request) {
    return this.scout.startScan((req.user as any).id);
  }

  /** The niches the owner can search: his campaign keywords, the ready niches, AliExpress's categories. */
  @Get('niches')
  niches(@Req() req: Request) {
    return this.scout.niches((req.user as any).id);
  }

  /** One niche's last result (`id` from the niche list). */
  @Get('niche')
  niche(@Req() req: Request, @Query('id') id: string) {
    return this.scout.nicheResult((req.user as any).id, String(id || '').slice(0, 90));
  }

  /** Search one niche now, in the background. Only ids on the niche list are accepted. */
  @Post('niche/scan')
  nicheScan(@Req() req: Request, @Body('id') id: string) {
    return this.scout.startNicheScan((req.user as any).id, String(id || '').slice(0, 90));
  }
}
