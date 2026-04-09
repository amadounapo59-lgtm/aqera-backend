import { Body, Controller, Get, Param, Post, Req, UseGuards, ParseIntPipe } from '@nestjs/common';
import { HttpException, HttpStatus } from '@nestjs/common';
import { MissionsService } from './missions.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Throttle } from '@nestjs/throttler';
import { AnalyticsService } from '../analytics/analytics.service';
import { EventNames, EntityTypes } from '../analytics/events';
import { getRequestContext, mergeContextIntoMetadata } from '../analytics/request-context';
import { RateLimitService } from '../security/rate-limit.service';
import { SecurityEventService } from '../security/security-event.service';
import { securityConfig } from '../security/security.config';

@Controller('missions')
export class MissionsController {
  constructor(
    private readonly missionsService: MissionsService,
    private readonly analytics: AnalyticsService,
    private readonly rateLimit: RateLimitService,
    private readonly securityEvents: SecurityEventService,
  ) {}

  // ✅ User: voir ses tentatives + statuts
  @UseGuards(JwtAuthGuard)
  @Get('my-attempts')
  myAttempts(@Req() req: any) {
    return this.missionsService.getMyAttempts(req.user.id);
  }

  // ✅ Liste des missions actives (avec attemptStatus si connecté)
  @UseGuards(JwtAuthGuard)
  @Get()
  async findActive(@Req() req: any) {
    const out = await this.missionsService.findActiveForUser(req.user.id);
    const ctx = getRequestContext(req);
    await this.analytics.logEvent({
      userId: req.user?.id,
      role: req.user?.role,
      eventName: EventNames.mission_feed_view,
      entityType: EntityTypes.MISSION,
      metadata: mergeContextIntoMetadata({ count_returned: out.missions?.length ?? 0 }, ctx),
    }).catch(() => {});
    return out;
  }

  // ✅ User: “J’ai terminé” => attempt PENDING (pas de crédit ici)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post(':missionId/submit')
  async submitAttempt(
    @Req() req: any,
    @Param('missionId', ParseIntPipe) missionId: number,
    @Body()
    body:
      | { timeToSubmitMs?: number; clientTimestamp?: number; platformUsername?: string }
      | undefined,
  ) {
    const ctx = getRequestContext(req);
    const secCtx = req.securityContext ?? { ip: 'unknown', deviceId: 'unknown' };
    if (securityConfig.rateLimitEnabled) {
      const res = await this.rateLimit.hit(
        `user:submit:${req.user.id}`,
        3600,
        securityConfig.submitPerUserPerHour,
      );
      if (!res.allowed) {
        await this.securityEvents.log('SUBMIT_BLOCKED', {
          userId: req.user.id,
          ip: secCtx.ip,
          deviceId: secCtx.deviceId,
          meta: { reason: 'rate_limit', resetAt: res.resetAt.toISOString() },
        });
        throw new HttpException(
          {
            code: 'RATE_LIMIT',
            message: 'Trop de soumissions. Réessaie plus tard.',
            resetAt: res.resetAt.toISOString(),
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    try {
      const out = await this.missionsService.submitAttempt(
        req.user.id,
        missionId,
        body?.platformUsername,
      );
      await this.analytics.logEvent({
        userId: req.user?.id,
        role: req.user?.role,
        eventName: EventNames.mission_submit_success,
        entityType: EntityTypes.MISSION_ATTEMPT,
        entityId: (out as any)?.attemptId ?? undefined,
        metadata: mergeContextIntoMetadata(
          {
            mission_id: missionId,
            time_to_submit_ms: body?.timeToSubmitMs,
            ...(out.platformUsername ? { platform_username: out.platformUsername } : {}),
          },
          ctx,
        ),
      }).catch(() => {});
      return out;
    } catch (e: any) {
      if (e?.status === 403 && e?.response?.code === 'BANNED') {
        await this.securityEvents.log('SUBMIT_BLOCKED', {
          userId: req.user?.id,
          ip: secCtx.ip,
          deviceId: secCtx.deviceId,
          meta: { reason: 'banned', missionId },
        });
      }
      await this.analytics.logEvent({
        userId: req.user?.id,
        role: req.user?.role,
        eventName: EventNames.mission_submit_failed,
        entityType: EntityTypes.MISSION,
        entityId: missionId,
        metadata: mergeContextIntoMetadata({ reason: e?.message ?? 'unknown', mission_id: missionId }, ctx),
      }).catch(() => {});
      throw e;
    }
  }
}