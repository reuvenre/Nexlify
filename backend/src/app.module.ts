import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import KeyvRedis from '@keyv/redis';
import { validateEnv } from './config/env.validation';
import { ThrottlerBehindProxyGuard } from './common/throttler-proxy.guard';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CredentialsModule } from './credentials/credentials.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { ProductsModule } from './products/products.module';
import { PostsModule } from './posts/posts.module';
import { EarningsModule } from './earnings/earnings.module';
import { RatesModule } from './rates/rates.module';
import { PersistentValueModule } from './common/persistent-value.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { ChannelsModule } from './channels/channels.module';
import { CouponsModule } from './coupons/coupons.module';
import { IncentiveModule } from './incentive/incentive.module';
import { NotificationsModule } from './notifications/notifications.module';
import { TemplatesModule } from './templates/templates.module';
import { CatalogModule } from './catalog/catalog.module';
import { MailModule } from './mail/mail.module';
import { AgentsModule } from './agents/agents.module';
import { DiscoveryModule } from './discovery/discovery.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { CustomPostsModule } from './custom-posts/custom-posts.module';
import { AmazonModule } from './amazon/amazon.module';
import { PinterestModule } from './pinterest/pinterest.module';
import { LinksModule } from './links/links.module';
import { PromotionsModule } from './promotions/promotions.module';
import { WatchdogModule } from './watchdog/watchdog.module';
import { RecoveryModule } from './recovery/recovery.module';
import { PaymentsModule } from './payments/payments.module';
import { OptimizerModule } from './optimizer/optimizer.module';
import { StorefrontModule } from './storefront/storefront.module';
import { SecurityModule } from './security/security.module';
import { StatsModule } from './stats/stats.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../.env', '.env'], // finds alibot-pro/.env when running from alibot-pro/backend/
      validate: validateEnv, // fail fast at boot on missing/short secrets (prod)
    }),
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      // Use Redis when REDIS_URL is configured; otherwise fall back to an
      // in-memory cache so the app runs with zero external dependencies
      // (e.g. a free single-instance deploy). Rates simply cache per-instance.
      //
      // That fallback makes this a per-PROCESS store, so a long TTL here buys nothing: a
      // deploy empties it. Anything that must survive one belongs in PersistentValueModule,
      // not here. Use this for what a cache is for — saving a repeat of work that can
      // simply be done again.
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
        // Auto-DDL only outside production, and never when DB_SYNC=false — a mis-set
        // NODE_ENV must not silently rewrite the production schema.
        synchronize: config.get('DB_SYNC') === 'false' ? false : config.get('NODE_ENV') !== 'production',
        migrations: ['dist/migrations/*.js'],
        // Prod migrations are run manually in main.ts (bootstrapProdSchema) so a truly
        // EMPTY database can build its baseline from the entities first — otherwise the
        // earliest ALTER migration hits a non-existent table and the deploy dies.
        migrationsRun: false,
        // Bound the pool: the per-minute crons + web traffic must not exhaust the
        // Postgres/pgBouncer connection ceiling ("sorry, too many clients").
        extra: { max: Number(config.get('DB_POOL_MAX')) || 10 },
        ssl: config.get('NODE_ENV') === 'production' && config.get('DATABASE_SSL') === 'true'
          ? { rejectUnauthorized: false }
          : false,
      }),
      inject: [ConfigService],
    }),
    // Global: where a value goes when it has to outlive the process (see the CacheModule
    // note above). Registered before the features so anything may inject its store.
    PersistentValueModule,
    AuthModule,
    UsersModule,
    CredentialsModule,
    CouponsModule,
    IncentiveModule,
    NotificationsModule,
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
    DiscoveryModule,
    SubscriptionModule,
    SuppliersModule,
    IntegrationsModule,
    CustomPostsModule,
    AmazonModule,
    PinterestModule,
    LinksModule,
    PromotionsModule,
    WatchdogModule,
    RecoveryModule,
    PaymentsModule,
    OptimizerModule,
    StorefrontModule,
    SecurityModule,
    StatsModule,
  ],
  controllers: [HealthController],
  providers: [
    // Enforce the 100 req/min/IP default on EVERY route (not just /auth). Public
    // routes and expensive authed routes were previously unthrottled. Uses the
    // proxy-aware guard so the limit is per REAL client, not per edge IP.
    { provide: APP_GUARD, useClass: ThrottlerBehindProxyGuard },
  ],
})
export class AppModule {}
