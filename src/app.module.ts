// src/app.module.ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { WalletModule } from './wallet/wallet.module';
import { MissionsModule } from './missions/missions.module';
import { ProductsModule } from './products/products.module';
import { BrandsModule } from './brands/brands.module';
import { GiftcardsModule } from './giftcards/giftcards.module';
import { AnalyticsModule } from './analytics/analytics.module';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AdminModule } from './admin/admin.module';
import { BrandApplicationsModule } from './brand-applications/brand-applications.module';
import { AgencyApplicationsModule } from './agency-applications/agency-applications.module';
import { BillingModule } from './billing/billing.module';
import { BrandModule } from './brand/brand.module';
import { SecurityModule } from './security/security.module';
import { AiModule } from './ai/ai.module';

@Module({
  imports: [
    SecurityModule,
    ThrottlerModule.forRoot([
      {
        ttl: 60,
        limit: 100,
      },
    ]),
    PrismaModule,
    AuthModule,
    WalletModule,
    MissionsModule,
    ProductsModule,
    BrandsModule,
    GiftcardsModule,
    AnalyticsModule,
    AdminModule,
    BrandApplicationsModule,
    AgencyApplicationsModule,
    BillingModule,
    BrandModule,
    AiModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}

