import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { SecurityService } from './security.service';

/** Admin-only view of the security audit log. */
@Controller('admin/security')
@UseGuards(JwtAuthGuard, AdminGuard)
export class SecurityController {
  constructor(private readonly svc: SecurityService) {}

  @Get('events')
  events(@Query('limit') limit = 100, @Query('type') type?: string) {
    return this.svc.list(Number(limit) || 100, type);
  }
}
