import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SecurityModule } from '../security/security.module';
import { MissionsModule } from '../missions/missions.module';
import { AiClientService } from './ai-client.service';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';

@Module({
  imports: [PrismaModule, SecurityModule, MissionsModule],
  controllers: [AiController],
  providers: [AiClientService, AiService],
  exports: [AiService],
})
export class AiModule {}
