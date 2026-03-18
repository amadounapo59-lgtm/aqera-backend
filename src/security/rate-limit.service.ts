import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type HitResult = { allowed: boolean; remaining: number; resetAt: Date };

@Injectable()
export class RateLimitService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * DB-based rate limit: increment count for key in current window; if window expired, reset.
   * Returns allowed (count <= max), remaining, resetAt (end of window).
   */
  async hit(key: string, windowSeconds: number, max: number): Promise<HitResult> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - windowSeconds * 1000);

    const existing = await this.prisma.rateLimitCounter.findUnique({ where: { key } });
    let count: number;
    let newWindowStart: Date;

    if (!existing) {
      count = 1;
      newWindowStart = now;
      await this.prisma.rateLimitCounter.create({
        data: { key, count: 1, windowStart: newWindowStart, windowSeconds },
      });
    } else {
      const existingStart = new Date(existing.windowStart);
      if (existingStart.getTime() < windowStart.getTime()) {
        count = 1;
        newWindowStart = now;
        await this.prisma.rateLimitCounter.update({
          where: { key },
          data: { count: 1, windowStart: newWindowStart, updatedAt: now },
        });
      } else {
        count = existing.count + 1;
        newWindowStart = existingStart;
        await this.prisma.rateLimitCounter.update({
          where: { key },
          data: { count, updatedAt: now },
        });
      }
    }

    const resetAt = new Date(newWindowStart.getTime() + windowSeconds * 1000);
    const allowed = count <= max;
    const remaining = Math.max(0, max - count);
    return { allowed, remaining, resetAt };
  }
}
