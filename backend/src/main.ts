import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  );

  // Allow the configured frontend, local dev, the project's Vercel deployments
  // (incl. preview/branch URLs), and Cloudflare quick tunnels. credentials:true
  // can't use a wildcard, so we reflect the origin when it matches.
  const allowList = [process.env.FRONTEND_URL, 'http://localhost:3000'].filter(Boolean) as string[];
  app.enableCors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // non-browser / same-origin
      let host = '';
      try { host = new URL(origin).hostname; } catch { /* ignore */ }
      const ok =
        allowList.includes(origin) ||
        host === 'localhost' ||
        host.endsWith('.vercel.app') ||
        host.endsWith('.trycloudflare.com');
      cb(null, ok);
    },
    credentials: true,
  });

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`AliBot PRO backend running on port ${port}`);
}
bootstrap();
