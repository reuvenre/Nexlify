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

  // Allow the configured frontend, local dev, and the project's OWN Vercel preview
  // deployments only. credentials:true can't use a wildcard, so we reflect the origin
  // when it matches. We do NOT reflect every *.vercel.app — that would let any attacker
  // deploy a site to Vercel and make credentialed requests. Restrict to the team suffix.
  const allowList = [process.env.FRONTEND_URL, 'http://localhost:3000'].filter(Boolean) as string[];
  // e.g. "-reuvenres-projects.vercel.app" — override via env if the team slug changes.
  const vercelSuffix = process.env.CORS_VERCEL_SUFFIX || '-reuvenres-projects.vercel.app';
  app.enableCors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // non-browser / same-origin
      let host = '';
      try { host = new URL(origin).hostname; } catch { /* ignore */ }
      const ok =
        allowList.includes(origin) ||
        host === 'localhost' ||
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
