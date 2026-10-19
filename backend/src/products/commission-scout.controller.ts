import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
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
}
