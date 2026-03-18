import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type AuthUser = { id: number; role?: string; brandId?: number | null; agencyId?: number | null };

const INTENT_WEIGHT: Record<string, number> = {
  COMMENT: 1.0,
  POST: 1.0,
  STORY: 0.8,
  FOLLOW: 0.5,
  LIKE: 0.2,
};

function costScore(cpaCents: number): number {
  if (cpaCents <= 20) return 30;
  if (cpaCents <= 50) return 24;
  if (cpaCents <= 100) return 16;
  if (cpaCents <= 200) return 8;
  return 2;
}

function volumeScore(actionsPerDay: number): number {
  if (actionsPerDay >= 60) return 15;
  if (actionsPerDay >= 30) return 12;
  if (actionsPerDay >= 10) return 8;
  if (actionsPerDay >= 3) return 4;
  return 1;
}

function qualityScore(rejectionRatePct: number): number {
  if (rejectionRatePct <= 5) return 15;
  if (rejectionRatePct <= 15) return 11;
  if (rejectionRatePct <= 30) return 7;
  return 2;
}

function conversionScore(roiMultiple: number): number {
  if (roiMultiple >= 4) return 20;
  if (roiMultiple >= 2.5) return 16;
  if (roiMultiple >= 1.5) return 12;
  if (roiMultiple >= 0.8) return 8;
  return 4;
}

function platformConsistencyScore(platformShares: Record<string, number>): number {
  const entries = Object.entries(platformShares).filter(([, v]) => v > 0);
  if (entries.length === 0) return 5;
  const maxShare = Math.max(...entries.map(([, v]) => v));
  const minShare = Math.min(...entries.map(([, v]) => v));
  if (maxShare >= 0.8) return 10;
  if (minShare >= 0.1 && entries.length >= 2) return 8;
  if (minShare < 0.1) return 4;
  return 5;
}

function typeMixQualityScore(weightedAvg: number): number {
  if (weightedAvg >= 0.75) return 10;
  if (weightedAvg >= 0.55) return 8;
  if (weightedAvg >= 0.35) return 6;
  if (weightedAvg >= 0.2) return 4;
  return 2;
}

@Injectable()
export class CampaignRoiService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveBrandId(user: AuthUser, brandId?: number): Promise<number> {
    const role = (user?.role ?? '').toUpperCase();
    if (role === 'BRAND' || role === 'BRAND_OWNER' || role === 'BRAND_STAFF') {
      if (!user.brandId) throw new BadRequestException('Marque non associée');
      return user.brandId;
    }
    if (role === 'AGENCY') {
      if (!user.agencyId || !brandId) throw new BadRequestException('brandId requis pour une agence');
      const link = await this.prisma.agencyBrand.findUnique({
        where: { uniq_agency_brand: { agencyId: user.agencyId, brandId } },
      });
      if (!link) throw new NotFoundException("Cette marque n'est pas gérée par ton agence");
      return brandId;
    }
    throw new BadRequestException('Accès interdit');
  }

  async getCampaignRoi(user: AuthUser, campaignId: number, brandId?: number) {
    const bid = await this.resolveBrandId(user, brandId);
    const id = Number(campaignId);
    if (!Number.isFinite(id) || id <= 0) throw new BadRequestException('campaignId invalide');

    const campaign = await this.prisma.campaign.findFirst({
      where: { id, brandId: bid },
      include: { missions: { include: { missionType: true } } },
    });
    if (!campaign) throw new NotFoundException('Campagne introuvable');

    const brandSettings = await this.prisma.brandSettings.findUnique({
      where: { brandId: bid },
    });
    const aovCents = brandSettings?.avgOrderValueCents ?? 0;
    const visitRateBps = brandSettings?.defaultVisitRateBps ?? 800;
    const leadRateBps = brandSettings?.defaultLeadRateBps ?? 200;
    const purchaseRateBps = brandSettings?.defaultPurchaseRateBps ?? 150;

    const missionIds = campaign.missions.map((m) => m.id);
    if (missionIds.length === 0) {
      return this.buildEmptyRoiResponse(campaign, aovCents, visitRateBps, leadRateBps, purchaseRateBps);
    }

    const [attempts, allCampaignsForBenchmark] = await Promise.all([
      this.prisma.missionAttempt.findMany({
        where: { missionId: { in: missionIds } },
        include: { mission: { include: { missionType: true } } },
      }),
      this.prisma.campaign.findMany({
        where: { brandId: bid },
        include: { missions: { include: { missionType: true } } },
      }),
    ]);

    const approved = attempts.filter((a) => a.status === 'APPROVED');
    const rejected = attempts.filter((a) => a.status === 'REJECTED');
    const pending = attempts.filter((a) => a.status === 'PENDING');
    const totalSpentCents = approved.reduce((sum, a) => {
      const cost = Number(a.mission?.missionType?.brandCostCents ?? 0);
      return sum + cost;
    }, 0);
    const approvedCount = approved.length;
    const totalAttempts = attempts.length;
    const rejectionRate = totalAttempts > 0 ? (rejected.length / totalAttempts) * 100 : 0;
    const costPerActionCents = approvedCount > 0 ? Math.round(totalSpentCents / approvedCount) : 0;

    const campaignStart = campaign.startsAt ?? campaign.createdAt;
    const startTime = campaignStart instanceof Date ? campaignStart.getTime() : new Date(campaignStart).getTime();
    const daysActive = Math.max(1, (Date.now() - startTime) / (24 * 60 * 60 * 1000));
    const actionsPerDay = approvedCount / daysActive;

    const reviewTimes: number[] = [];
    for (const a of approved) {
      if (a.reviewedAt && a.createdAt) {
        const ms = (a.reviewedAt instanceof Date ? a.reviewedAt.getTime() : new Date(a.reviewedAt).getTime())
          - (a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime());
        reviewTimes.push(ms);
      }
    }
    const avgReviewTimeMs = reviewTimes.length > 0 ? reviewTimes.reduce((s, t) => s + t, 0) / reviewTimes.length : 0;

    const costSc = costScore(costPerActionCents);
    const volSc = volumeScore(actionsPerDay);
    const qualSc = qualityScore(rejectionRate);

    const byPlatform: Record<string, number> = {};
    for (const a of approved) {
      const platform = (a.mission?.platform ?? 'UNKNOWN').toUpperCase();
      byPlatform[platform] = (byPlatform[platform] ?? 0) + 1;
    }
    const totalByPlatform = Object.values(byPlatform).reduce((s, n) => s + n, 0);
    const platformShares: Record<string, number> = {};
    for (const [k, v] of Object.entries(byPlatform)) {
      platformShares[k] = totalByPlatform > 0 ? v / totalByPlatform : 0;
    }
    const platformConsistencySc = platformConsistencyScore(platformShares);

    const byMissionType: Record<string, number> = {};
    let weightedSum = 0;
    let typeCount = 0;
    for (const a of approved) {
      const code = (a.mission?.missionType?.code ?? 'LIKE').toUpperCase();
      byMissionType[code] = (byMissionType[code] ?? 0) + 1;
      weightedSum += INTENT_WEIGHT[code] ?? 0.2;
      typeCount += 1;
    }
    const weightedAvgIntent = typeCount > 0 ? weightedSum / typeCount : 0;
    const typeMixSc = typeMixQualityScore(weightedAvgIntent);

    const estimatedProfileVisits = Math.floor((approvedCount * visitRateBps) / 10000);
    const estimatedLeads = Math.floor((approvedCount * leadRateBps) / 10000);
    const estimatedPurchases = Math.floor((approvedCount * purchaseRateBps) / 10000);
    const projectedRevenueCents = estimatedPurchases * aovCents;
    const projectedRoiMultiple = totalSpentCents > 0 ? projectedRevenueCents / totalSpentCents : 0;
    const conversionSc = conversionScore(projectedRoiMultiple);

    const roiScore = Math.min(100, Math.max(0,
      costSc + volSc + qualSc + conversionSc + platformConsistencySc + typeMixSc,
    ));
    let grade: string;
    if (roiScore >= 85) grade = 'EXCELLENT';
    else if (roiScore >= 70) grade = 'GOOD';
    else if (roiScore >= 50) grade = 'AVERAGE';
    else grade = 'POOR';

    const dailyStatsMap = new Map<string, number>();
    for (const a of approved) {
      const d = a.reviewedAt ?? a.createdAt;
      const key = d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
      dailyStatsMap.set(key, (dailyStatsMap.get(key) ?? 0) + 1);
    }
    const dailyStats = Array.from(dailyStatsMap.entries())
      .map(([date, approvedActions]) => ({ date, approvedActions }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const last3 = dailyStats.slice(-3);
    let trend: 'UP' | 'STABLE' | 'DOWN' = 'STABLE';
    if (last3.length >= 2) {
      const slope = last3.length === 2
        ? last3[1].approvedActions - last3[0].approvedActions
        : (last3[2].approvedActions - last3[0].approvedActions) / 2;
      if (slope > 0.5) trend = 'UP';
      else if (slope < -0.5) trend = 'DOWN';
    }

    let totalCPA = 0;
    let totalRejectionRate = 0;
    let totalActionsPerDay = 0;
    let campaignCountCPA = 0;
    let campaignCountRate = 0;
    for (const c of allCampaignsForBenchmark) {
      const mids = c.missions.map((m) => m.id);
      if (mids.length === 0) continue;
      const atts = await this.prisma.missionAttempt.findMany({
        where: { missionId: { in: mids } },
        include: { mission: { include: { missionType: true } } },
      });
      const appr = atts.filter((a) => a.status === 'APPROVED');
      const rej = atts.filter((a) => a.status === 'REJECTED');
      const spent = appr.reduce((s, a) => s + Number(a.mission?.missionType?.brandCostCents ?? 0), 0);
      if (appr.length > 0) {
        totalCPA += spent / appr.length;
        campaignCountCPA += 1;
      }
      if (atts.length > 0) {
        totalRejectionRate += (rej.length / atts.length) * 100;
        campaignCountRate += 1;
      }
      const cStart = c.startsAt ?? c.createdAt;
      const cDays = Math.max(1, (Date.now() - (cStart instanceof Date ? cStart.getTime() : new Date(cStart).getTime())) / (24 * 60 * 60 * 1000));
      totalActionsPerDay += appr.length / cDays;
    }
    const averageCPA = campaignCountCPA > 0 ? totalCPA / campaignCountCPA : 0;
    const averageRejectionRate = campaignCountRate > 0 ? totalRejectionRate / campaignCountRate : 0;
    const averageActionsPerDay = allCampaignsForBenchmark.length > 0 ? totalActionsPerDay / allCampaignsForBenchmark.length : 0;

    const campaignPerformanceVsAverage: string[] = [];
    if (campaignCountCPA > 0 && averageCPA > 0) {
      const pct = ((averageCPA - costPerActionCents) / averageCPA) * 100;
      if (pct > 5) campaignPerformanceVsAverage.push(`CPA ${Math.round(pct)}% meilleur que la moyenne`);
      else if (pct < -5) campaignPerformanceVsAverage.push(`CPA ${Math.round(-pct)}% plus élevé que la moyenne`);
    }
    if (rejectionRate > averageRejectionRate + 5) {
      campaignPerformanceVsAverage.push('Taux de rejet plus élevé que la moyenne');
    } else if (rejectionRate < averageRejectionRate - 5 && averageRejectionRate > 0) {
      campaignPerformanceVsAverage.push('Taux de rejet inférieur à la moyenne');
    }
    if (actionsPerDay > averageActionsPerDay * 1.2 && averageActionsPerDay > 0) {
      campaignPerformanceVsAverage.push('Volume d’actions supérieur à la moyenne');
    }

    const insights: string[] = [];
    if (costSc >= 24 && campaignCountCPA > 0) insights.push('Votre coût par action est excellent par rapport aux autres campagnes.');
    if (rejectionRate > 15) insights.push('Le taux de rejet est élevé — envisagez d’améliorer les consignes des missions.');
    const commentCount = byMissionType['COMMENT'] ?? 0;
    const likeCount = byMissionType['LIKE'] ?? 0;
    if (commentCount > likeCount && likeCount > 0) insights.push('Les missions Comment génèrent plus d’engagement que les Likes.');
    if (trend === 'DOWN' && dailyStats.length >= 3) insights.push('La dynamique de la campagne ralentit — envisagez d’ajouter de nouvelles missions.');
    if (campaignPerformanceVsAverage.some((s) => s.includes('meilleur'))) insights.push('Votre campagne performe mieux que la moyenne sur cette plateforme.');
    if (insights.length > 5) insights.length = 5;

    const breakdownByPlatform = Object.entries(byPlatform).map(([platform, count]) => ({ platform, count }));
    const breakdownByMissionType = Object.entries(byMissionType).map(([missionType, count]) => ({ missionType, count }));

    return {
      campaignId: campaign.id,
      campaignName: campaign.name,
      roiScore: Math.round(roiScore * 10) / 10,
      grade,
      metrics: {
        approvedActions: approvedCount,
        rejectedActions: rejected.length,
        pendingActions: pending.length,
        costPerActionCents,
        actionsPerDay: Math.round(actionsPerDay * 100) / 100,
        rejectionRate: Math.round(rejectionRate * 100) / 100,
        avgReviewTimeMs: Math.round(avgReviewTimeMs),
        totalSpentCents,
      },
      subscores: {
        costScore: costSc,
        volumeScore: volSc,
        qualityScore: qualSc,
        conversionScore: conversionSc,
        platformConsistencyScore: platformConsistencySc,
        typeMixQualityScore: typeMixSc,
      },
      breakdown: {
        byPlatform: breakdownByPlatform,
        byMissionType: breakdownByMissionType,
      },
      projections: {
        estimatedProfileVisits,
        estimatedLeads,
        estimatedPurchases,
        projectedRevenueCents,
        projectedRoiMultiple: Math.round(projectedRoiMultiple * 100) / 100,
      },
      benchmark: {
        averageCPA: Math.round(averageCPA),
        averageRejectionRate: Math.round(averageRejectionRate * 100) / 100,
        averageActionsPerDay: Math.round(averageActionsPerDay * 100) / 100,
        campaignPerformanceVsAverage,
      },
      trend,
      insights,
      dailyStats,
      assumptions: {
        visitRateBps,
        leadRateBps,
        purchaseRateBps,
        aovCents,
        note: 'Pilot estimation without real sales tracking',
      },
    };
  }

  private buildEmptyRoiResponse(
    campaign: { id: number; name: string },
    aovCents: number,
    visitRateBps: number,
    leadRateBps: number,
    purchaseRateBps: number,
  ) {
    return {
      campaignId: campaign.id,
      campaignName: campaign.name,
      roiScore: 0,
      grade: 'POOR' as const,
      metrics: {
        approvedActions: 0,
        rejectedActions: 0,
        pendingActions: 0,
        costPerActionCents: 0,
        actionsPerDay: 0,
        rejectionRate: 0,
        avgReviewTimeMs: 0,
        totalSpentCents: 0,
      },
      subscores: {
        costScore: 0,
        volumeScore: 1,
        qualityScore: 15,
        conversionScore: 4,
        platformConsistencyScore: 5,
        typeMixQualityScore: 2,
      },
      breakdown: { byPlatform: [], byMissionType: [] },
      projections: {
        estimatedProfileVisits: 0,
        estimatedLeads: 0,
        estimatedPurchases: 0,
        projectedRevenueCents: 0,
        projectedRoiMultiple: 0,
      },
      benchmark: {
        averageCPA: 0,
        averageRejectionRate: 0,
        averageActionsPerDay: 0,
        campaignPerformanceVsAverage: [] as string[],
      },
      trend: 'STABLE' as const,
      insights: ['Aucune action approuvée pour l’instant. Les métriques ROI apparaîtront lorsque des missions seront validées.'],
      dailyStats: [] as { date: string; approvedActions: number }[],
      assumptions: {
        visitRateBps,
        leadRateBps,
        purchaseRateBps,
        aovCents,
        note: 'Pilot estimation without real sales tracking',
      },
    };
  }
}
