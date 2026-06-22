import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { IsArray, IsOptional, IsString, ArrayMaxSize } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DiscoveryService } from './discovery.service';

class HuntDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  keywords?: string[];
}

@Controller('discovery')
@UseGuards(JwtAuthGuard)
export class DiscoveryController {
  constructor(private readonly svc: DiscoveryService) {}

  /** Scrape AliExpress for the given keywords and add fresh finds to the catalog. */
  @Post('hunt')
  hunt(@Req() req: Request, @Body() dto: HuntDto) {
    const keywords = (dto.keywords?.length ? dto.keywords : ['tacti gear'])
      .map((k) => k.trim())
      .filter(Boolean);
    return this.svc.hunt((req.user as any).id, keywords);
  }

  /** Check that catalog affiliate links still resolve. */
  @Post('validate')
  validate(@Req() req: Request) {
    return this.svc.validateLinks((req.user as any).id);
  }
}
