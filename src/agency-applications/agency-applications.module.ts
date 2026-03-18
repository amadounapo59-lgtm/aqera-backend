import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AgencyApplicationsController } from './agency-applications.controller';
import { AgencyApplicationsService } from './agency-applications.service';

@Module({
  imports: [PrismaModule],
  controllers: [AgencyApplicationsController],
  providers: [AgencyApplicationsService],
})
export class AgencyApplicationsModule {}
