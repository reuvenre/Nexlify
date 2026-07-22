import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { LinksService } from './links.service';

/** PUBLIC routes — shoppers hit these from published posts; no auth, no cookies needed. */
@Controller('r')
export class LinksController {
  constructor(private readonly svc: LinksService) {}

  /**
   * JSON resolve for the frontend's /r/[code] route handler (the pretty domain).
   * Recording happens here because this call IS the click. Declared before ':code'
   * so Nest matches the more specific path first.
   */
  @Get(':code/resolve')
  async resolve(@Param('code') code: string, @Req() req: Request) {
    const url = await this.svc.click(
      code,
      (req.headers['x-forwarded-referrer'] as string) || (req.headers.referer as string),
      req.headers['user-agent'] as string,
    );
    return { url: url || null };
  }

  /** Direct backend redirect — works standalone if a short link points at the API host. */
  @Get(':code')
  async redirect(@Param('code') code: string, @Req() req: Request, @Res() res: Response) {
    const url = await this.svc.click(code, req.headers.referer as string, req.headers['user-agent'] as string);
    if (!url) return res.status(404).send('Link not found');
    return res.redirect(302, url);
  }
}
