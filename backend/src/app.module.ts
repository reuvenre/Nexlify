import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import KeyvRedis from '@keyv/redis';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CredentialsModule } from './credentials/credentials.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { ProductsModule } from './products/products.module';
import { PostsModule } from './posts/posts.module';
import { EarningsModule } from './earnings/earnings.module';
import { RatesModule } from './rates/rates.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { ChannelsModule } from './channels/channels.module';
import { TemplatesModule } from './templates/templates.module';
import { CatalogModule } from './catalog/catalog.module';
import { MailModule } from './mail/mail.module';
import { AgentsModule } from './agents/agents.module';
import { AdsModule } from './ads/ads.module';
import { DiscoveryModule } from './discovery/discovery.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../.env', '.env'], // finds alibot-pro/.env when running from alibot-pro/backend/
    }),
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      // Use Redis when REDIS_URL is configured; otherwise fall back to an
      // in-memory cache so the app runs with zero external dependencies
      // (e.g. a free single-instance deploy). Rates simply cache per-instance.
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL');
        const options: { ttl: number; stores?: KeyvRedis[] } = { ttl: 0 };
        if (redisUrl) options.stores = [new KeyvRedis(redisUrl)];
        return options;
      },
      inject: [ConfigService],
    }),
    ScheduleModule.forRoot(),
    // Default rate limit: 100 requests / minute per IP. Sensitive auth routes
    // tighten this further via @Throttle on the controller.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL'),
        autoLoadEntities: true,
        synchronize: config.get('NODE_ENV') !== 'production',
        migrations: ['dist/migrations/*.js'],
        migrationsRun: config.get('NODE_ENV') === 'production',
        ssl: config.get('NODE_ENV') === 'production' && config.get('DATABASE_SSL') === 'true'
          ? { rejectUnauthorized: false }
          : false,
      }),
      inject: [ConfigService],
    }),
    AuthModule,
    UsersModule,
    CredentialsModule,
    CampaignsModule,
    ProductsModule,
    PostsModule,
    EarningsModule,
    RatesModule,
    SchedulerModule,
    ChannelsModule,
    TemplatesModule,
    CatalogModule,
    MailModule,
    AgentsModule,
    AdsModule,
    DiscoveryModule,
    SubscriptionModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
