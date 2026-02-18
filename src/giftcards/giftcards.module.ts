import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WalletModule } from '../wallet/wallet.module';
import { GiftcardsController } from './giftcards.controller';
import { GiftcardsService } from './giftcards.service';

@Module({
  imports: [PrismaModule, WalletModule],
  controllers: [GiftcardsController],
  providers: [GiftcardsService],
})
export class GiftcardsModule {}