import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SecurityContextMiddleware } from './security-context.middleware';
import { RateLimitService } from './rate-limit.service';
import { SecurityEventService } from './security-event.service';

@Module({
  imports: [PrismaModule],
  providers: [SecurityContextMiddleware, RateLimitService, SecurityEventService],
  exports: [RateLimitService, SecurityEventService],
})
export class SecurityModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(SecurityContextMiddleware).forRoutes('*');
  }
}
