import { Controller, Get, Put, Post, Body, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CredentialsService } from './credentials.service';
import { CredentialSetDto } from './dto/credential-set.dto';

@Controller('credentials')
@UseGuards(JwtAuthGuard)
export class CredentialsController {
  constructor(private readonly svc: CredentialsService) {}

  @Get()
  get(@Req() req: Request) {
    return this.svc.get((req.user as any).id);
  }

  @Put()
  upsert(@Req() req: Request, @Body() dto: CredentialSetDto) {
    return this.svc.upsert((req.user as any).id, dto);
  }

  @Post('verify')
  verify(@Req() req: Request) {
    return this.svc.verify((req.user as any).id);
  }

  /** Facebook Page token expiry — drives the Settings countdown + dashboard banner. */
  @Get('token-status')
  tokenStatus(@Req() req: Request) {
    return this.svc.getTokenStatus((req.user as any).id);
  }
}
