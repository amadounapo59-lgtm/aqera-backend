// src/app.module.ts
import { Module } from '@nestjs/common';

import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { WalletModule } from './wallet/wallet.module';
import { MissionsModule } from './missions/missions.module';
import { ProductsModule } from './products/products.module';
import { BrandsModule } from './brands/brands.module';
import { GiftcardsModule } from './giftcards/giftcards.module';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AdminModule } from './admin/admin.module';
import { BrandApplicationsModule } from './brand-applications/brand-applications.module';
import { AgencyApplicationsModule } from './agency-applications/agency-applications.module';
import { BillingModule } from './billing/billing.module';
@Module({
  imports: [
    PrismaModule,
    AuthModule,
    WalletModule,
    MissionsModule,
    ProductsModule,
    BrandsModule,
    GiftcardsModule,
    AdminModule,
    BrandApplicationsModule,
    AgencyApplicationsModule,
    BillingModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

