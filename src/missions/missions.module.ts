import { Module } from '@nestjs/common';
import { MissionsService } from './missions.service';
import { MissionsController } from './missions.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [PrismaModule, WalletModule], // 👈 accès DB + Wallet
  controllers: [MissionsController],
  providers: [MissionsService],
})
export class MissionsModule {}
