import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { PromotionsService, PromoInput } from './promotions.service';

/** Public: the currently-active deals — the /pricing page renders these before signup. */
@Controller('promotions')
export class PromotionsController {
  constructor(private readonly svc: PromotionsService) {}

  @Get('active')
  active() {
    return this.svc.active();
  }
}

/** Admin CRUD for promotions. */
@Controller('admin/promotions')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminPromotionsController {
  constructor(private readonly svc: PromotionsService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Post()
  @HttpCode(201)
  create(@Body() body: PromoInput) {
    return this.svc.create(body);
  }

  @Patch(':id')
  @HttpCode(200)
  update(@Param('id') id: string, @Body() body: Partial<PromoInput>) {
    return this.svc.update(id, body);
  }

  @Delete(':id')
  @HttpCode(200)
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
