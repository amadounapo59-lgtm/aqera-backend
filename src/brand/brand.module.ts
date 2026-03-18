import { Module } from '@nestjs/common';
import { BrandController } from './brand.controller';
import { BrandService } from './brand.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SecurityModule } from '../security/security.module';
import { AiModule } from '../ai/ai.module';
import { BrandsModule } from '../brands/brands.module';

@Module({
  imports: [PrismaModule, SecurityModule, AiModule, BrandsModule],
  controllers: [BrandController],
  providers: [BrandService],
  exports: [BrandService],
})
export class BrandModule {}
