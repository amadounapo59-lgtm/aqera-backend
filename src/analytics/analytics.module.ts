import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { DailyMetricsService } from './daily-metrics.service';
import { ScoreService } from './score.service';

@Module({
  imports: [PrismaModule, forwardRef(() => AuthModule)],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, DailyMetricsService, ScoreService],
  exports: [AnalyticsService, DailyMetricsService, ScoreService],
})
export class AnalyticsModule {}
