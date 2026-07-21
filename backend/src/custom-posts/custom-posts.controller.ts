import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards, HttpCode } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CustomPostsService } from './custom-posts.service';

@Controller('custom-posts')
@UseGuards(JwtAuthGuard)
export class CustomPostsController {
  constructor(private readonly svc: CustomPostsService) {}
  private uid(req: Request): string { return (req.user as any).id; }

  @Get()
  list(@Req() req: Request) { return this.svc.list(this.uid(req)); }

  @Post()
  @HttpCode(201)
  create(@Req() req: Request, @Body() dto: any) { return this.svc.create(this.uid(req), dto); }

  @Patch(':id')
  update(@Req() req: Request, @Param('id') id: string, @Body() dto: any) { return this.svc.update(this.uid(req), id, dto); }

  @Delete(':id')
  remove(@Req() req: Request, @Param('id') id: string) { return this.svc.remove(this.uid(req), id); }
}
