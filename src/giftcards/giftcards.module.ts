import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WalletModule } from '../wallet/wallet.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { SecurityModule } from '../security/security.module';
import { GiftcardsController } from './giftcards.controller';
import { GiftcardsService } from './giftcards.service';

@Module({
  imports: [PrismaModule, WalletModule, AnalyticsModule, SecurityModule],
  controllers: [GiftcardsController],
  providers: [GiftcardsService],
})
export class GiftcardsModule {}