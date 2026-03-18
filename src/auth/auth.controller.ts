import { Body, Controller, Get, Post, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Throttle } from '@nestjs/throttler';
import { AnalyticsService } from '../analytics/analytics.service';
import { EventNames } from '../analytics/events';
import { getRequestContext, mergeContextIntoMetadata } from '../analytics/request-context';
import { RateLimitService } from '../security/rate-limit.service';
import { SecurityEventService } from '../security/security-event.service';
import { securityConfig } from '../security/security.config';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly analytics: AnalyticsService,
    private readonly rateLimit: RateLimitService,
    private readonly securityEvents: SecurityEventService,
  ) {}

  // POST /auth/register
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('register')
  async register(
    @Req() req: any,
    @Body('email') email: string,
    @Body('password') password: string,
    @Body('name') name?: string,
    @Body('fullName') fullName?: string,
  ) {
    const ctx = getRequestContext(req);
    const secCtx = req.securityContext ?? { ip: 'unknown', deviceId: 'unknown' };
    if (securityConfig.rateLimitEnabled) {
      const res = await this.rateLimit.hit(
        `ip:register:${secCtx.ip}`,
        3600,
        securityConfig.registerPerIpPerHour,
      );
      if (!res.allowed) {
        await this.securityEvents.log('RATE_LIMIT', {
          ip: secCtx.ip,
          deviceId: secCtx.deviceId,
          meta: { endpoint: 'register', resetAt: res.resetAt.toISOString() },
        });
        throw new HttpException(
          {
            code: 'RATE_LIMIT',
            message: 'Trop de créations de compte. Réessaie plus tard.',
            resetAt: res.resetAt.toISOString(),
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    try {
      const out = await this.authService.register(email, password, name, fullName);
      await this.securityEvents.log('REGISTER', {
        userId: out.user?.id,
        ip: secCtx.ip,
        deviceId: secCtx.deviceId,
        meta: { email_domain: (email || '').split('@')[1] ?? null },
      });
      await this.analytics.logEvent({
        eventName: EventNames.auth_register_success,
        entityType: 'AUTH',
        metadata: mergeContextIntoMetadata({ email_domain: (email || '').split('@')[1] ?? null }, ctx),
      });
      return out;
    } catch (e: any) {
      await this.analytics.logEvent({
        eventName: EventNames.auth_register_failed,
        entityType: 'AUTH',
        metadata: mergeContextIntoMetadata({ reason: e?.message ?? 'unknown' }, ctx),
      }).catch(() => {});
      throw e;
    }
  }

  // POST /auth/login — on retourne un objet brut pour garantir la forme { token, user } côté client
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('login')
  async login(
    @Req() req: any,
    @Body('email') email: string,
    @Body('password') password: string,
  ) {
    const ctx = getRequestContext(req);
    const secCtx = req.securityContext ?? { ip: 'unknown', deviceId: 'unknown' };
    if (securityConfig.rateLimitEnabled) {
      const res = await this.rateLimit.hit(
        `ip:login:${secCtx.ip}`,
        900,
        securityConfig.loginPerIpPer15Min,
      );
      if (!res.allowed) {
        await this.securityEvents.log('RATE_LIMIT', {
          ip: secCtx.ip,
          deviceId: secCtx.deviceId,
          meta: { endpoint: 'login', resetAt: res.resetAt.toISOString() },
        });
        throw new HttpException(
          {
            code: 'RATE_LIMIT',
            message: 'Trop de tentatives de connexion. Réessaie plus tard.',
            resetAt: res.resetAt.toISOString(),
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    try {
      const out = await this.authService.login(email, password, secCtx);
      if (!out?.user) {
        throw new HttpException(
          { message: 'Erreur interne: réponse login sans utilisateur' },
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
      await this.securityEvents.log('LOGIN_OK', {
        userId: out.user.id,
        ip: secCtx.ip,
        deviceId: secCtx.deviceId,
      });
      await this.analytics.logEvent({
        userId: out.user.id,
        role: out.user.role,
        eventName: EventNames.auth_login_success,
        entityType: 'AUTH',
        metadata: mergeContextIntoMetadata({ email_domain: (email || '').split('@')[1] ?? null }, ctx),
      });
      const u = out.user as any;
      return {
        token: out.token,
        user: {
          id: u.id,
          email: u.email,
          name: u.name ?? '',
          balanceCents: u.balanceCents ?? 0,
          badgeLevel: u.badgeLevel ?? 'STARTER',
          dailyCapCents: u.dailyCapCents ?? 0,
          role: u.role ?? 'USER',
          brandId: u.brandId ?? null,
          agencyId: u.agencyId ?? null,
          mustChangePassword: u.mustChangePassword === true,
          isActive: u.isActive !== false,
          emailVerified: Boolean(u.emailVerified),
          createdAt: u.createdAt instanceof Date ? u.createdAt.toISOString() : u.createdAt,
          lastActiveAt: u.lastActiveAt instanceof Date ? u.lastActiveAt.toISOString() : u.lastActiveAt,
        },
      };
    } catch (e: any) {
      await this.securityEvents.log('LOGIN_FAIL', {
        ip: secCtx.ip,
        deviceId: secCtx.deviceId,
        meta: { email: (email || '').slice(0, 3) + '***' },
      });
      await this.analytics.logEvent({
        eventName: EventNames.auth_login_failed,
        entityType: 'AUTH',
        metadata: mergeContextIntoMetadata({ reason: e?.message ?? 'unknown' }, ctx),
      }).catch(() => {});
      throw e;
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@Req() req: any) {
    return this.authService.getMe(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  async changePassword(
    @Req() req: any,
    @Body('currentPassword') currentPassword: string | undefined,
    @Body('newPassword') newPassword: string,
  ) {
    const ctx = getRequestContext(req);
    try {
      const out = await this.authService.changePassword(req.user.id, newPassword, currentPassword);
      await this.analytics.logEvent({
        userId: req.user?.id,
        role: req.user?.role,
        eventName: EventNames.auth_change_password_success,
        entityType: 'AUTH',
        metadata: mergeContextIntoMetadata({}, ctx),
      });
      return out;
    } catch (e: any) {
      await this.analytics.logEvent({
        userId: req.user?.id,
        role: req.user?.role,
        eventName: EventNames.auth_change_password_failed,
        entityType: 'AUTH',
        metadata: mergeContextIntoMetadata({ reason: e?.message ?? 'unknown' }, ctx),
      }).catch(() => {});
      throw e;
    }
  }
}