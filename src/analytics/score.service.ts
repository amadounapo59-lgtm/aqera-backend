import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventNames } from './events';
import { chunk, IN_CLAUSE_CHUNK_SIZE } from '../common/utils/chunk';

@Injectable()
export class ScoreService {
  constructor(private readonly prisma: PrismaService) {}

  async recomputeUserScores(): Promise<void> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const activeUserIds = await this.prisma.eventLog
      .findMany({
        where: {
          createdAt: { gte: sevenDaysAgo },
          userId: { not: null },
          eventName: { in: [EventNames.mission_submit_success, EventNames.mission_attempt_approved, EventNames.mission_attempt_rejected] },
        },
        select: { userId: true },
        distinct: ['userId'],
      })
      .then((rows) => rows.map((r) => r.userId!).filter(Boolean));

    if (activeUserIds.length === 0) return;

    const chunks = chunk(activeUserIds, IN_CLAUSE_CHUNK_SIZE);
    let submits1hByUser: { userId: number | null; _count: { userId: number } }[] = [];
    let rejects7dByUser: { userId: number | null; _count: { userId: number } }[] = [];
    let approvals7dByUser: { userId: number | null; _count: { userId: number } }[] = [];
    let timeToSubmitByUser: { userId: number | null; metadata: unknown }[] = [];

    for (const ids of chunks) {
      const [s1, r7, a7, t7] = await Promise.all([
        this.prisma.eventLog.groupBy({
          by: ['userId'],
          where: {
            eventName: EventNames.mission_submit_success,
            userId: { in: ids },
            createdAt: { gte: oneHourAgo },
          },
          _count: { userId: true },
        }),
        this.prisma.eventLog.groupBy({
          by: ['userId'],
          where: {
            eventName: EventNames.mission_attempt_rejected,
            userId: { in: ids },
            createdAt: { gte: sevenDaysAgo },
          },
          _count: { userId: true },
        }),
        this.prisma.eventLog.groupBy({
          by: ['userId'],
          where: {
            eventName: EventNames.mission_attempt_approved,
            userId: { in: ids },
            createdAt: { gte: sevenDaysAgo },
          },
          _count: { userId: true },
        }),
        this.prisma.eventLog.findMany({
          where: {
            eventName: EventNames.mission_submit_success,
            userId: { in: ids },
            createdAt: { gte: sevenDaysAgo },
          },
          select: { userId: true, metadata: true },
        }),
      ]);
      submits1hByUser = submits1hByUser.concat(s1);
      rejects7dByUser = rejects7dByUser.concat(r7);
      approvals7dByUser = approvals7dByUser.concat(a7);
      timeToSubmitByUser = timeToSubmitByUser.concat(t7);
    }

    const submits1hMap = new Map<number, number>();
    submits1hByUser.forEach((r) => { if (r.userId != null) submits1hMap.set(r.userId, r._count.userId); });
    const rejects7dMap = new Map<number, number>();
    rejects7dByUser.forEach((r) => { if (r.userId != null) rejects7dMap.set(r.userId, r._count.userId); });
    const approvals7dMap = new Map<number, number>();
    approvals7dByUser.forEach((r) => { if (r.userId != null) approvals7dMap.set(r.userId, r._count.userId); });

    const timeSumByUser = new Map<number, { sum: number; count: number }>();
    for (const e of timeToSubmitByUser) {
      if (e.userId == null) continue;
      const meta = (e.metadata as { time_to_submit_ms?: number }) ?? {};
      const ms = meta.time_to_submit_ms;
      if (typeof ms !== 'number' || !Number.isFinite(ms)) continue;
      const cur = timeSumByUser.get(e.userId) ?? { sum: 0, count: 0 };
      cur.sum += ms;
      cur.count += 1;
      timeSumByUser.set(e.userId, cur);
    }

    for (const userId of activeUserIds) {
      const submits1h = submits1hMap.get(userId) ?? 0;
      const rejects7d = rejects7dMap.get(userId) ?? 0;
      const approvals7d = approvals7dMap.get(userId) ?? 0;
      const total7d = approvals7d + rejects7d;
      const rejectRate7d = total7d > 0 ? rejects7d / total7d : 0;
      const timeData = timeSumByUser.get(userId);
      const avgTimeToSubmitMs7d = timeData && timeData.count > 0 ? Math.round(timeData.sum / timeData.count) : 0;

      let trustScore = 50;
      if (approvals7d >= 5) trustScore += 10;
      if (rejectRate7d > 0.4) trustScore -= 20;
      if (submits1h > 10) trustScore -= 15;
      if (avgTimeToSubmitMs7d > 0 && avgTimeToSubmitMs7d < 8000) trustScore -= 10;
      trustScore = Math.max(0, Math.min(100, trustScore));

      let riskLevel = 'MEDIUM';
      if (trustScore < 30 || submits1h > 15 || rejectRate7d > 0.6) riskLevel = 'HIGH';
      else if (trustScore >= 70 && rejectRate7d < 0.2) riskLevel = 'LOW';

      const existing = await this.prisma.userScore.findUnique({ where: { userId } });
      const previousRiskLevel = existing?.riskLevel ?? null;

      await this.prisma.userScore.upsert({
        where: { userId },
        create: {
          userId,
          trustScore,
          riskLevel,
          rejects7d,
          submits1h,
          avgTimeToSubmitMs: avgTimeToSubmitMs7d,
          updatedAt: new Date(),
        },
        update: {
          trustScore,
          riskLevel,
          rejects7d,
          submits1h,
          avgTimeToSubmitMs: avgTimeToSubmitMs7d,
          updatedAt: new Date(),
        },
      });

      // Pilote: alerte admin quand transition vers HIGH (pas d'auto dailyCapCents=0)
      if (riskLevel === 'HIGH' && previousRiskLevel !== 'HIGH') {
        const reasons: string[] = [];
        if (trustScore < 30) reasons.push('trustScore_low');
        if (submits1h > 15) reasons.push('submits1h_high');
        if (rejectRate7d > 0.6) reasons.push('rejectRate_high');
        const metadataJson = {
          riskScore: trustScore,
          reasons,
          rejects7d,
          submits1h,
          avgTimeToSubmitMs7d,
          rejectRate7d,
        };

        const openAlert = await this.prisma.adminAlert.findFirst({
          where: { type: 'USER_RISK_HIGH', userId, status: 'OPEN' },
        });
        if (openAlert) {
          await this.prisma.adminAlert.update({
            where: { id: openAlert.id },
            data: { metadataJson: metadataJson as any, updatedAt: new Date() },
          });
        } else {
          await this.prisma.adminAlert.create({
            data: {
              type: 'USER_RISK_HIGH',
              severity: 'HIGH',
              message: 'User flagged high risk by scoring rules',
              userId,
              metadataJson: metadataJson as any,
              status: 'OPEN',
            },
          });
        }
      }
    }
  }

  async recomputeMissionTypePerformance(): Promise<void> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [attemptsWithMission, submitEvents, approvedEntityIds, rejectedEntityIds] = await Promise.all([
      this.prisma.missionAttempt.findMany({
        where: { createdAt: { gte: sevenDaysAgo } },
        include: { mission: { include: { missionType: true } } },
      }),
      this.prisma.eventLog.findMany({
        where: { eventName: EventNames.mission_submit_success, createdAt: { gte: sevenDaysAgo } },
        select: { entityId: true, metadata: true },
      }),
      this.prisma.eventLog.findMany({
        where: { eventName: EventNames.mission_attempt_approved, createdAt: { gte: sevenDaysAgo } },
        select: { entityId: true },
      }),
      this.prisma.eventLog.findMany({
        where: { eventName: EventNames.mission_attempt_rejected, createdAt: { gte: sevenDaysAgo } },
        select: { entityId: true },
      }),
    ]);

    const approvedSet = new Set(approvedEntityIds.map((e) => e.entityId).filter(Boolean));
    const rejectedSet = new Set(rejectedEntityIds.map((e) => e.entityId).filter(Boolean));

    const key = (code: string, platform: string) => `${code}|${platform}`;
    const byKey: Record<string, { views7d: number; submits7d: number; approvals7d: number; rejections7d: number; timeSum: number; timeCount: number }> = {};

    for (const a of attemptsWithMission) {
      const code = a.mission?.missionType?.code ?? 'UNKNOWN';
      const plat = (a.mission?.platform ?? '').toUpperCase() || 'INSTAGRAM';
      const k = key(code, plat);
      if (!byKey[k]) byKey[k] = { views7d: 0, submits7d: 0, approvals7d: 0, rejections7d: 0, timeSum: 0, timeCount: 0 };
      byKey[k].submits7d += 1;
      if (approvedSet.has(a.id)) byKey[k].approvals7d += 1;
      if (rejectedSet.has(a.id)) byKey[k].rejections7d += 1;
    }

    for (const e of submitEvents) {
      const meta = (e.metadata as { time_to_submit_ms?: number }) ?? {};
      if (e.entityId) {
        const att = attemptsWithMission.find((a) => a.id === e.entityId);
        if (att) {
          const code = att.mission?.missionType?.code ?? 'UNKNOWN';
          const plat = (att.mission?.platform ?? '').toUpperCase() || 'INSTAGRAM';
          const k = key(code, plat);
          if (!byKey[k]) byKey[k] = { views7d: 0, submits7d: 0, approvals7d: 0, rejections7d: 0, timeSum: 0, timeCount: 0 };
          if (typeof meta.time_to_submit_ms === 'number' && Number.isFinite(meta.time_to_submit_ms)) {
            byKey[k].timeSum += meta.time_to_submit_ms;
            byKey[k].timeCount += 1;
          }
        }
      }
    }

    const views7dGlobal = await this.prisma.eventLog.count({
      where: { eventName: { in: [EventNames.mission_view, EventNames.mission_feed_view] }, createdAt: { gte: sevenDaysAgo } },
    });
    const viewsPerKey = Math.max(1, Object.keys(byKey).length);
    const viewsDefault = Math.max(1, Math.floor(views7dGlobal / viewsPerKey));

    for (const [k, v] of Object.entries(byKey)) {
      const [missionTypeCode, platform] = k.split('|');
      const views7d = viewsDefault;
      const completionRate7d = v.submits7d / Math.max(1, views7d);
      const totalRev = v.approvals7d + v.rejections7d;
      const approvalRate7d = totalRev > 0 ? v.approvals7d / totalRev : 0;
      const avgTimeToSubmitMs7d = v.timeCount > 0 ? Math.round(v.timeSum / v.timeCount) : 0;

      await this.prisma.missionTypePerformance.upsert({
        where: { uniq_type_platform: { missionTypeCode, platform } },
        create: {
          missionTypeCode,
          platform,
          views7d,
          submits7d: v.submits7d,
          approvals7d: v.approvals7d,
          rejections7d: v.rejections7d,
          completionRate7d,
          approvalRate7d,
          avgTimeToSubmitMs7d,
          updatedAt: new Date(),
        },
        update: {
          views7d,
          submits7d: v.submits7d,
          approvals7d: v.approvals7d,
          rejections7d: v.rejections7d,
          completionRate7d,
          approvalRate7d,
          avgTimeToSubmitMs7d,
          updatedAt: new Date(),
        },
      });
    }
  }
}
