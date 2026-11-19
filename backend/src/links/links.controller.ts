import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { LinksService } from './links.service';

/** PUBLIC routes — shoppers hit these from published posts; no auth, no cookies needed. */
@Controller('r')
export class LinksController {
  constructor(private readonly svc: LinksService) {}

  /**
   * JSON resolve, kept for older frontends (the pretty domain now proxies /r/<code>
   * straight to the redirect below).
   * Recording happens here because this call IS the click. Declared before ':code'
   * so Nest matches the more specific path first. `s` is the platform tag the send
   * path stamped on the published link (?s=tg/fb/…), forwarded by the frontend.
   */
  @Get(':code/resolve')
  async resolve(@Param('code') code: string, @Req() req: Request, @Query('s') s?: string) {
    const url = await this.svc.click(
      code,
      (req.headers['x-forwarded-referrer'] as string) || (req.headers.referer as string),
      req.headers['user-agent'] as string,
      s,
    );
    return { url: url || null };
  }

  /**
   * The redirect behind every short link. The pretty domain proxies <site>/r/<code> here
   * (frontend next.config.js rewrite), so the click costs no function on the frontend host.
   * An unknown or expired code goes to SHORT_LINK_FALLBACK_URL (the store's public page,
   * e.g. the Telegram channel) when set, else the site's home page — never a bare 404 for
   * a shopper who clicked a product ad.
   */
  @Get(':code')
  async redirect(@Param('code') code: string, @Req() req: Request, @Res() res: Response, @Query('s') s?: string) {
    const url = await this.svc.click(code, req.headers.referer as string, req.headers['user-agent'] as string, s);
    if (url) return res.redirect(302, url);
    return res.redirect(302, unknownCodeTarget());
  }
}

/** Where an unknown short code sends the shopper. */
export function unknownCodeTarget(env: NodeJS.ProcessEnv = process.env): string {
  const fallback = String(env.SHORT_LINK_FALLBACK_URL || '').trim();
  if (/^https?:\/\//i.test(fallback)) return fallback;
  const home = String(env.FRONTEND_URL || '').split(',')[0].trim().replace(/\/$/, '');
  return /^https?:\/\//i.test(home) ? `${home}/` : 'https://www.aliexpress.com/';
}
