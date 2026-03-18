import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WalletModule } from '../wallet/wallet.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { SecurityModule } from '../security/security.module';
import { AiModule } from '../ai/ai.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [PrismaModule, WalletModule, AnalyticsModule, SecurityModule, AiModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}