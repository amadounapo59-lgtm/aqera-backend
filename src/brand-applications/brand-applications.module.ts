import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BrandApplicationsController } from './brand-applications.controller';
import { BrandApplicationsService } from './brand-applications.service';

@Module({
  imports: [PrismaModule],
  controllers: [BrandApplicationsController],
  providers: [BrandApplicationsService],
})
export class BrandApplicationsModule {}