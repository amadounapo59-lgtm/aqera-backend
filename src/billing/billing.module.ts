import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BillingController } from './billing.controller';
import { BillingWebhookController } from './billing.webhook.controller';
import { BillingService } from './billing.service';

@Module({
  controllers: [BillingController, BillingWebhookController],
  providers: [BillingService, PrismaService],
  exports: [BillingService],
})
export class BillingModule {}
