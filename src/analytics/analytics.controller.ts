import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { EventNames } from './events';
import { getRequestContext, mergeContextIntoMetadata } from './request-context';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /**
   * POST /analytics/event — log a single event (auth optional).
   * If Authorization header present, userId/role are attached.
   */
  @Post('event')
  @UseGuards(OptionalJwtAuthGuard)
  async logEvent(@Req() req: any, @Body() body: any) {
    const ctx = getRequestContext(req);
    const eventName = body?.eventName;
    if (!eventName || typeof eventName !== 'string') {
      return { success: false, message: 'eventName required' };
    }
    const metadata = mergeContextIntoMetadata(body?.metadata ?? undefined, ctx);
    const userId = req?.user?.id ?? null;
    const role = req?.user?.role ?? null;
    try {
      await this.analytics.logEvent({
        userId,
        role,
        eventName: eventName as keyof typeof EventNames,
        entityType: body?.entityType ?? undefined,
        entityId: body?.entityId != null ? Number(body.entityId) : undefined,
        metadata: Object.keys(metadata).length ? metadata : undefined,
      });
      return { success: true };
    } catch (e: any) {
      return { success: false, message: e?.message ?? 'Invalid event' };
    }
  }
}
