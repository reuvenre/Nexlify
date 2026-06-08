import {
  Controller, Get, Patch, Param, Body, Query, Req, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RecommendationsService } from './recommendations.service';
import { ReviewRecommendationDto } from './dto/review-recommendation.dto';

@Controller('recommendations')
@UseGuards(JwtAuthGuard)
export class RecommendationsController {
  constructor(private readonly recommendations: RecommendationsService) {}

  @Get()
  async list(
    @Req() req: any,
    @Query('status') status?: string,
    @Query('agent_type') agentType?: string,
    @Query('category') category?: string,
  ) {
    return this.recommendations.list(req.user.userId, { status, agent_type: agentType, category });
  }

  @Get(':id')
  async get(@Req() req: any, @Param('id') id: string) {
    return this.recommendations.get(req.user.userId, id);
  }

  @Patch(':id/approve')
  async approve(@Req() req: any, @Param('id') id: string, @Body() dto: ReviewRecommendationDto) {
    return this.recommendations.approve(req.user.userId, id, dto.note);
  }

  @Patch(':id/reject')
  async reject(@Req() req: any, @Param('id') id: string, @Body() dto: ReviewRecommendationDto) {
    return this.recommendations.reject(req.user.userId, id, dto.note);
  }
}
