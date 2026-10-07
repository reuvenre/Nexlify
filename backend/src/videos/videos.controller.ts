import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Query, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { MAX_VIDEO_BYTES, VideosService } from './videos.service';

/**
 * The renderer's side of a Reel (GitHub Actions) and Meta's. PUBLIC on purpose: neither can
 * log in. Every route is gated by a per-job capability token — the renderer's for the spec
 * and the result, a separate one for the MP4 that Meta fetches.
 */
@SkipThrottle()
@Controller('videos')
export class VideosController {
  constructor(private readonly videos: VideosService) {}

  @Get('jobs/:id/spec')
  async spec(@Param('id') id: string, @Query('t') t: string) {
    const spec = await this.videos.specFor(id, t);
    if (!spec) throw new NotFoundException();
    return spec;
  }

  /** The finished MP4, as the raw request body (Content-Type: video/mp4). */
  @Post('jobs/:id/result')
  @HttpCode(200)
  async result(@Param('id') id: string, @Query('t') t: string, @Req() req: Request) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req as any) {
      size += chunk.length;
      if (size > MAX_VIDEO_BYTES) throw new NotFoundException();
      chunks.push(chunk);
    }
    const error = await this.videos.acceptResult(id, t, Buffer.concat(chunks));
    if (error) throw new NotFoundException(error);
    return { ok: true };
  }

  @Post('jobs/:id/failed')
  @HttpCode(200)
  async failed(@Param('id') id: string, @Query('t') t: string, @Body() body: { error?: string }) {
    await this.videos.acceptFailure(id, t, String(body?.error || 'unknown'));
    return { ok: true };
  }

  /** The Reel itself, for Instagram's and Facebook's fetchers. Supports a single byte range. */
  @Get(':file')
  async media(@Param('file') file: string, @Query('t') t: string, @Req() req: Request, @Res() res: Response) {
    const id = file.replace(/\.mp4$/, '');
    const buf = await this.videos.media(id, t);
    if (!buf) { res.status(404).send('not found'); return; }
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : buf.length - Number(range[2]);
      const end = range[1] && range[2] ? Math.min(Number(range[2]), buf.length - 1) : buf.length - 1;
      if (start < 0 || start > end) { res.status(416).setHeader('Content-Range', `bytes */${buf.length}`).end(); return; }
      res.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${buf.length}`);
      res.setHeader('Content-Length', String(end - start + 1));
      res.end(buf.subarray(start, end + 1));
      return;
    }
    res.setHeader('Content-Length', String(buf.length));
    res.end(buf);
  }
}
