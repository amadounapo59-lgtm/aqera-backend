import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventNames, type EventName, type EntityType } from './events';

export type LogEventParams = {
  userId?: number | null;
  role?: string | null;
  eventName: EventName;
  entityType?: EntityType | string | null;
  entityId?: number | null;
  metadata?: Record<string, unknown> | null;
};

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private isValidEventName(name: string): name is EventName {
    return Object.values(EventNames).includes(name as EventName);
  }

  async logEvent(params: LogEventParams): Promise<void> {
    const { userId, role, eventName, entityType, entityId, metadata } = params;
    if (!this.isValidEventName(eventName)) {
      throw new BadRequestException(`Invalid eventName: ${eventName}. Use EventNames.* constants.`);
    }
    try {
      await this.prisma.eventLog.create({
        data: {
          userId: userId ?? undefined,
          role: role ?? undefined,
          eventName,
          entityType: entityType ?? undefined,
          entityId: entityId ?? undefined,
          metadata: metadata ? (metadata as object) : undefined,
        },
      });
    } catch (err) {
      // Do not block the product if analytics fails
      // eslint-disable-next-line no-console
      console.warn('[Analytics] logEvent failed:', err);
    }
  }
}
