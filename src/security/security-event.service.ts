import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { securityConfig } from './security.config';
import { structuredLog } from '../common/logger/structured.logger';

export type SecurityEventType =
  | 'REGISTER'
  | 'LOGIN_FAIL'
  | 'LOGIN_OK'
  | 'SUBMIT_BLOCKED'
  | 'PURCHASE_BLOCKED'
  | 'REDEEM'
  | 'RATE_LIMIT'
  | 'BANNED_ACTION';

@Injectable()
export class SecurityEventService {
  constructor(private readonly prisma: PrismaService) {}

  async log(
    type: SecurityEventType,
    opts: { userId?: number; ip?: string; deviceId?: string; meta?: Record<string, unknown> },
  ): Promise<void> {
    if (!securityConfig.auditLogEnabled) return;
    try {
      await this.prisma.securityEvent.create({
        data: {
          type,
          userId: opts.userId ?? null,
          ip: opts.ip ?? null,
          deviceId: opts.deviceId ?? null,
          meta: opts.meta ? (opts.meta as any) : null,
        },
      });
      structuredLog.info('security_event', { type, userId: opts.userId, ip: opts.ip, deviceId: opts.deviceId, meta: opts.meta });
    } catch {
      // best-effort audit
    }
  }
}
