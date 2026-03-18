import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  Headers,
} from '@nestjs/common';
import { HttpException, HttpStatus } from '@nestjs/common';
import { GiftcardsService } from './giftcards.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { Throttle } from '@nestjs/throttler';
import { AnalyticsService } from '../analytics/analytics.service';
import { EventNames, EntityTypes } from '../analytics/events';
import { RateLimitService } from '../security/rate-limit.service';
import { SecurityEventService } from '../security/security-event.service';
import { securityConfig } from '../security/security.config';

@Controller('giftcards')
export class GiftcardsController {
  constructor(
    private readonly giftcardsService: GiftcardsService,
    private readonly analyticsService: AnalyticsService,
    private readonly rateLimit: RateLimitService,
    private readonly securityEvents: SecurityEventService,
  ) {}

  // USER — list giftcards
  @Get()
  async getAll(@Req() req: any) {
    const result = await this.giftcardsService.findAll();
    const count = result?.giftCards?.length ?? 0;
    await this.analyticsService.logEvent({
      userId: (req as any).user?.id ?? undefined,
      role: (req as any).user?.role ?? undefined,
      eventName: EventNames.giftcard_list_view,
      metadata: { count_returned: count },
    });
    return result;
  }

  // USER — purchase (with idempotency)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('purchase')
  async purchase(
    @Req() req: any,
    @Body('giftCardId') giftCardId: number,
    @Headers('Idempotency-Key') idempotencyKey?: string,
  ) {
    const userId = req.user.id;
    const gid = Number(giftCardId);
    const secCtx = req.securityContext ?? { ip: 'unknown', deviceId: 'unknown' };
    if (securityConfig.rateLimitEnabled) {
      const res = await this.rateLimit.hit(
        `user:purchase:${userId}`,
        86400,
        securityConfig.purchasePerUserPerDay,
      );
      if (!res.allowed) {
        await this.securityEvents.log('PURCHASE_BLOCKED', {
          userId,
          ip: secCtx.ip,
          deviceId: secCtx.deviceId,
          meta: { reason: 'rate_limit', resetAt: res.resetAt.toISOString() },
        });
        throw new HttpException(
          {
            code: 'RATE_LIMIT',
            message: 'Trop d\'achats aujourd\'hui. Réessaie demain.',
            resetAt: res.resetAt.toISOString(),
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    await this.analyticsService.logEvent({
      userId,
      role: req.user.role,
      eventName: EventNames.giftcard_purchase_attempt,
      entityType: EntityTypes.GIFT_CARD,
      entityId: gid,
    });
    try {
      const result = await this.giftcardsService.purchaseByUserId(userId, gid, idempotencyKey);
      await this.analyticsService.logEvent({
        userId,
        role: req.user.role,
        eventName: EventNames.giftcard_purchase_success,
        entityType: EntityTypes.GIFT_CARD,
        entityId: gid,
        metadata: { purchase_id: (result as any)?.purchase?.id },
      });
      return result;
    } catch (err: any) {
      if (err?.status === 403 && err?.response?.code === 'EMAIL_NOT_VERIFIED') {
        await this.securityEvents.log('PURCHASE_BLOCKED', {
          userId,
          ip: secCtx.ip,
          deviceId: secCtx.deviceId,
          meta: { reason: 'email_not_verified' },
        });
      }
      await this.analyticsService.logEvent({
        userId,
        role: req.user.role,
        eventName: EventNames.giftcard_purchase_failed,
        entityType: EntityTypes.GIFT_CARD,
        entityId: gid,
        metadata: { reason: err instanceof Error ? err.message : 'unknown' },
      });
      throw err;
    }
  }

  // USER — my purchases
  @UseGuards(JwtAuthGuard)
  @Get('my-purchases')
  myPurchases(@Req() req: any, @Query('status') status?: string) {
    return this.giftcardsService.getMyPurchases(req.user.id, status);
  }

  // BRAND / BRAND_OWNER / BRAND_STAFF or ADMIN — validate card (purchase + inventory → USED)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'BRAND_OWNER', 'BRAND_STAFF', 'ADMIN')
  @Post('purchases/:id/use')
  usePurchase(@Req() req: any, @Param('id') id: string) {
    return this.giftcardsService.usePurchase(Number(id), req.user.id);
  }

  // BRAND / BRAND_OWNER / BRAND_STAFF — redeem by code (validation carte côté marque)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'BRAND_OWNER', 'BRAND_STAFF')
  @Post('redeem')
  redeemByCode(@Req() req: any, @Body('code') code: string) {
    return this.giftcardsService.redeemByCode(code, req.user.id, req.user.brandId);
  }
}