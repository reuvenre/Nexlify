import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PinterestService } from './pinterest.service';

@Controller('pinterest')
@UseGuards(JwtAuthGuard)
export class PinterestController {
  constructor(private readonly svc: PinterestService) {}

  /** Per-pin performance (30 days) + totals for the reports screen. */
  @Get('analytics')
  analytics(@Req() req: Request) {
    return this.svc.analytics((req.user as any).id);
  }
}
