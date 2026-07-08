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

  // Allow the configured frontend(s), local dev, the project's production domain,
  // and the project's OWN Vercel preview deployments. credentials:true can't use a
  // wildcard, so we reflect the origin when it matches. We do NOT reflect every
  // *.vercel.app — that would let any attacker deploy a site to Vercel and make
  // credentialed requests. Restrict to specific hosts + the team suffix.
  // FRONTEND_URL accepts a comma-separated list for multiple domains.
  const allowList = [
    ...(process.env.FRONTEND_URL || '').split(',').map((s) => s.trim()).filter(Boolean),
    'http://localhost:3000',
  ];
  // The project's main production domain does NOT carry the team suffix
  // (ali-bot-pro.vercel.app vs *-reuvenres-projects.vercel.app) — allow it explicitly.
  const allowedHosts = ['localhost', 'ali-bot-pro.vercel.app'];
  // e.g. "-reuvenres-projects.vercel.app" — override via env if the team slug changes.
  const vercelSuffix = process.env.CORS_VERCEL_SUFFIX || '-reuvenres-projects.vercel.app';
  app.enableCors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // non-browser / same-origin
      let host = '';
      try { host = new URL(origin).hostname; } catch { /* ignore */ }
      const ok =
        allowList.includes(origin) ||
        allowedHosts.includes(host) ||
        host.endsWith(vercelSuffix);
      cb(null, ok);
    },
    credentials: true,
  });

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`AliBot PRO backend running on port ${port}`);
}
bootstrap();
