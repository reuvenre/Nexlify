import {
  Controller, Get, Post, Patch, Delete, Body, Param,
  Query, Req, UseGuards, HttpCode,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CampaignsService } from './campaigns.service';
import { PostsService } from '../posts/posts.service';
import { SupplierProductsService } from '../suppliers/supplier-products.service';
import { AmazonService } from '../amazon/amazon.service';
import { CampaignDto } from './dto/campaign.dto';

@Controller('campaigns')
@UseGuards(JwtAuthGuard)
export class CampaignsController {
  constructor(
    private readonly svc: CampaignsService,
    private readonly posts: PostsService,
    private readonly suppliers: SupplierProductsService,
    private readonly amazon: AmazonService,
  ) {}

  private uid(req: Request) { return (req.user as any).id; }

  @Get()
  list(
    @Req() req: Request,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('status') status?: string,
  ) {
    return this.svc.list(this.uid(req), +page, +limit, status);
  }

  @Get(':id')
  get(@Req() req: Request, @Param('id') id: string) {
    return this.svc.getPublic(this.uid(req), id); // target_channels as an array for the UI
  }

  @Post()
  create(@Req() req: Request, @Body() dto: CampaignDto) {
    return this.svc.create(this.uid(req), dto);
  }

  @Patch(':id')
  update(@Req() req: Request, @Param('id') id: string, @Body() dto: Partial<CampaignDto>) {
    return this.svc.update(this.uid(req), id, dto);
  }

  @Delete(':id')
  delete(@Req() req: Request, @Param('id') id: string) {
    return this.svc.delete(this.uid(req), id);
  }

  @Post(':id/pause')
  @HttpCode(200)
  pause(@Req() req: Request, @Param('id') id: string) {
    return this.svc.pause(this.uid(req), id);
  }

  @Post(':id/resume')
  @HttpCode(200)
  resume(@Req() req: Request, @Param('id') id: string) {
    return this.svc.resume(this.uid(req), id);
  }

  /**
   * Run the campaign NOW and report what actually happened. This used to be
   * fire-and-forget with `.catch(() => {})`, so the UI reported "queued — posts will go
   * out shortly" even when the run threw immediately and published nothing. The run takes
   * seconds (one AliExpress query + one AI generation per post), so we await it and
   * return the real outcome; any error propagates as a normal HTTP error.
   */
  @Post(':id/run')
  @HttpCode(200)
  async runNow(@Req() req: Request, @Param('id') id: string) {
    const campaign = await this.svc.get(this.uid(req), id);
    // FLYLINK rotates the linked supplier catalog; Amazon keyword-searches PA-API; AliExpress
    // keyword-searches the affiliate API.
    if (campaign.source === 'flylink') return this.suppliers.runFlylinkCampaign(campaign, this.uid(req));
    if (campaign.source === 'amazon') return this.amazon.runAmazonCampaign(campaign, this.uid(req));
    return this.posts.runCampaign(campaign, this.uid(req));
  }

  @Get(':id/posts')
  campaignPosts(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.posts.list(this.uid(req), +page, +limit, undefined, id);
  }
}
