import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Req, UseGuards, HttpCode,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ChannelsService } from './channels.service';
import { CreateChannelDto, UpdateChannelDto } from './dto/channel.dto';

@Controller('channels')
@UseGuards(JwtAuthGuard)
export class ChannelsController {
  constructor(private readonly service: ChannelsService) {}

  @Get()
  list(@Req() req: any) {
    return this.service.list(req.user.id);
  }

  @Post()
  create(@Req() req: any, @Body() dto: CreateChannelDto) {
    return this.service.create(req.user.id, dto);
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateChannelDto) {
    return this.service.update(req.user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  delete(@Req() req: any, @Param('id') id: string) {
    return this.service.delete(req.user.id, id);
  }

  @Post(':id/test')
  test(@Req() req: any, @Param('id') id: string) {
    return this.service.test(req.user.id, id);
  }

  /** Verify the Facebook Page configured for this channel (read + publish-capability check). */
  @Post(':id/test-facebook')
  @HttpCode(200)
  testFacebook(@Req() req: any, @Param('id') id: string) {
    return this.service.testFacebook(req.user.id, id);
  }

  /** Verify the account's Instagram Business account + linked Page token (account-global). */
  @Post('test-instagram')
  @HttpCode(200)
  testInstagram(@Req() req: any) {
    return this.service.testInstagram(req.user.id);
  }
}
