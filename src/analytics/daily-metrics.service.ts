import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventNames } from './events';
import { chunk, IN_CLAUSE_CHUNK_SIZE } from '../common/utils/chunk';

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

@Injectable()
export class DailyMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async recomputeDailyMetrics(dateKey: string): Promise<void> {
    const dayStart = new Date(dateKey + 'T00:00:00.000Z');
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    const nextDayStart = new Date(dayStart);
    nextDayStart.setUTCDate(nextDayStart.getUTCDate() + 1);
    const nextDayEnd = new Date(nextDayStart);
    nextDayEnd.setUTCDate(nextDayEnd.getUTCDate() + 1);

    const day7Start = new Date(dayStart);
    day7Start.setUTCDate(day7Start.getUTCDate() + 7);
    const day7End = new Date(day7Start);
    day7End.setUTCDate(day7End.getUTCDate() + 1);

    // 1) DAU = distinct userId with (auth_login_success OR app_open OR app_screen_view) on D
    const dauRows = await this.prisma.eventLog.groupBy({
      by: ['userId'],
      where: {
        userId: { not: null },
        eventName: { in: [EventNames.auth_login_success, EventNames.app_open, EventNames.app_screen_view] },
        createdAt: { gte: dayStart, lt: dayEnd },
      },
    });
    const dau = dauRows.length;

    // 2) newUsers = count auth_register_success on D
    const newUsers = await this.prisma.eventLog.count({
      where: {
        eventName: EventNames.auth_register_success,
        createdAt: { gte: dayStart, lt: dayEnd },
      },
    });

    // 3) missionViews: mission_view on D, fallback to mission_feed_view
    const missionViews = await this.prisma.eventLog.count({
      where: {
        eventName: EventNames.mission_view,
        createdAt: { gte: dayStart, lt: dayEnd },
      },
    });
    const missionViewsFallback = await this.prisma.eventLog.count({
      where: {
        eventName: EventNames.mission_feed_view,
        createdAt: { gte: dayStart, lt: dayEnd },
      },
    });
    const missionViewsTotal = missionViews > 0 ? missionViews : missionViewsFallback;

    // 4) missionSubmits, approvals, rejections, giftcardPurchases, margin
    const [missionSubmits, missionApprovals, missionRejections, giftcardPurchases, marginRows] = await Promise.all([
      this.prisma.eventLog.count({
        where: { eventName: EventNames.mission_submit_success, createdAt: { gte: dayStart, lt: dayEnd } },
      }),
      this.prisma.eventLog.count({
        where: { eventName: EventNames.mission_attempt_approved, createdAt: { gte: dayStart, lt: dayEnd } },
      }),
      this.prisma.eventLog.count({
        where: { eventName: EventNames.mission_attempt_rejected, createdAt: { gte: dayStart, lt: dayEnd } },
      }),
      this.prisma.eventLog.count({
        where: { eventName: EventNames.giftcard_purchase_success, createdAt: { gte: dayStart, lt: dayEnd } },
      }),
      this.prisma.eventLog.findMany({
        where: { eventName: EventNames.platform_margin_earned, createdAt: { gte: dayStart, lt: dayEnd } },
        select: { metadata: true },
      }),
    ]);

    const marginEarnedCents = marginRows.reduce((sum, r) => {
      const meta = r.metadata as { margin_cents?: number } | null;
      return sum + (Number(meta?.margin_cents) || 0);
    }, 0);

    const completionRate = missionSubmits / Math.max(1, missionViewsTotal);
    const totalReviewed = missionApprovals + missionRejections;
    const approvalRate = totalReviewed > 0 ? missionApprovals / totalReviewed : 0;
    const avgMissionsPerActiveUser = missionSubmits / Math.max(1, dau);

    // 7) activationRate24h: cohort = users with auth_register_success on D; activated = those with mission_submit_success in [D, D+1)
    const cohortRegister = await this.prisma.eventLog.findMany({
      where: { eventName: EventNames.auth_register_success, createdAt: { gte: dayStart, lt: dayEnd }, userId: { not: null } },
      select: { userId: true },
      distinct: ['userId'],
    });
    const cohortUserIds = cohortRegister.map((r) => r.userId!).filter(Boolean);
    const activatedUserIds = new Set<number>();
    if (cohortUserIds.length > 0) {
      for (const ids of chunk(cohortUserIds, IN_CLAUSE_CHUNK_SIZE)) {
        const rows = await this.prisma.eventLog.findMany({
          where: {
            eventName: EventNames.mission_submit_success,
            userId: { in: ids },
            createdAt: { gte: dayStart, lt: nextDayEnd },
          },
          select: { userId: true },
          distinct: ['userId'],
        });
        rows.forEach((r) => { if (r.userId != null) activatedUserIds.add(r.userId); });
      }
    }
    const activationRate24h = cohortUserIds.length > 0 ? activatedUserIds.size / cohortUserIds.length : 0;

    // 8) retentionD1: baseUsers = DAU on D; retainedD1 = baseUsers with activity on D+1
    const baseUserIds = dauRows.map((r) => r.userId!).filter(Boolean);
    const retainedD1Ids = new Set<number>();
    const retainedD7Ids = new Set<number>();
    if (baseUserIds.length > 0) {
      for (const ids of chunk(baseUserIds, IN_CLAUSE_CHUNK_SIZE)) {
        const [activeNextDay, activeDay7] = await Promise.all([
          this.prisma.eventLog.findMany({
            where: {
              userId: { in: ids },
              eventName: { in: [EventNames.auth_login_success, EventNames.app_open, EventNames.app_screen_view] },
              createdAt: { gte: nextDayStart, lt: nextDayEnd },
            },
            select: { userId: true },
            distinct: ['userId'],
          }),
          this.prisma.eventLog.findMany({
            where: {
              userId: { in: ids },
              eventName: { in: [EventNames.auth_login_success, EventNames.app_open, EventNames.app_screen_view] },
              createdAt: { gte: day7Start, lt: day7End },
            },
            select: { userId: true },
            distinct: ['userId'],
          }),
        ]);
        activeNextDay.forEach((r) => { if (r.userId != null) retainedD1Ids.add(r.userId); });
        activeDay7.forEach((r) => { if (r.userId != null) retainedD7Ids.add(r.userId); });
      }
    }
    const retentionD1 = baseUserIds.length > 0 ? retainedD1Ids.size / baseUserIds.length : 0;
    const retentionD7 = baseUserIds.length > 0 ? retainedD7Ids.size / baseUserIds.length : 0;

    // 10) avgTimeToFirstRewardHours: cohort = register_success on D; first reward = min(wallet_available_added | giftcard_purchase_success) after register
    const registerEvents = await this.prisma.eventLog.findMany({
      where: { eventName: EventNames.auth_register_success, createdAt: { gte: dayStart, lt: dayEnd }, userId: { not: null } },
      select: { userId: true, createdAt: true },
    });
    const hoursToReward: number[] = [];
    for (const reg of registerEvents) {
      const uid = reg.userId!;
      const regTime = reg.createdAt.getTime();
      const rewardEvents = await this.prisma.eventLog.findMany({
        where: {
          userId: uid,
          eventName: { in: [EventNames.wallet_available_added, EventNames.giftcard_purchase_success] },
          createdAt: { gte: reg.createdAt },
        },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' },
        take: 1,
      });
      if (rewardEvents.length > 0) {
        const firstRewardTime = rewardEvents[0].createdAt.getTime();
        hoursToReward.push((firstRewardTime - regTime) / (1000 * 60 * 60));
      }
    }
    const avgTimeToFirstRewardHours =
      hoursToReward.length > 0 ? hoursToReward.reduce((a, b) => a + b, 0) / hoursToReward.length : 0;

    await this.prisma.dailyMetrics.upsert({
      where: { dateKey },
      create: {
        dateKey,
        dau,
        newUsers,
        missionSubmits,
        missionApprovals,
        missionRejections,
        giftcardPurchases,
        marginEarnedCents,
        activationRate24h,
        retentionD1,
        retentionD7,
        avgTimeToFirstRewardHours,
        approvalRate,
        completionRate,
        avgMissionsPerActiveUser,
      },
      update: {
        dau,
        newUsers,
        missionSubmits,
        missionApprovals,
        missionRejections,
        giftcardPurchases,
        marginEarnedCents,
        activationRate24h,
        retentionD1,
        retentionD7,
        avgTimeToFirstRewardHours,
        approvalRate,
        completionRate,
        avgMissionsPerActiveUser,
        updatedAt: new Date(),
      },
    });
  }

  async getDailyRange(from: string, to: string): Promise<{ metrics: any[] }> {
    const start = new Date(from + 'T00:00:00.000Z');
    const end = new Date(to + 'T23:59:59.999Z');
    const metrics: any[] = [];
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const dateKey = toDateKey(d);
      const existing = await this.prisma.dailyMetrics.findUnique({ where: { dateKey } });
      if (!existing) {
        await this.recomputeDailyMetrics(dateKey);
      }
      const row = await this.prisma.dailyMetrics.findUnique({ where: { dateKey } });
      if (row) metrics.push(row);
    }
    return { metrics };
  }
}
