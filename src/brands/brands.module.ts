import { Module } from '@nestjs/common';
import { BrandsService } from './brands.service';
import { BrandsController } from './brands.controller';
import { CampaignRoiService } from './campaign-roi.service';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [AnalyticsModule],
  controllers: [BrandsController],
  providers: [BrandsService, CampaignRoiService, PrismaService],
  exports: [CampaignRoiService],
})
export class BrandsModule {}