import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

/** Server local TZ — single source for dateKey (YYYY-MM-DD). */
function getDateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfNextLocalDay(d = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() + 1);
  return x;
}

@Injectable()
export class MissionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Single source of truth: UserDailyEarning for today's dateKey (server local TZ). */
  private async getDailyCapState(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('Utilisateur introuvable');

    const capCents = Number(user.dailyCapCents ?? 1000);
    const dateKey = getDateKey();

    const row = await this.prisma.userDailyEarning.findUnique({
      where: { uniq_user_day: { userId, dateKey } },
    });
    const earnedTodayCents = row?.earnedCents ?? 0;
    const remainingTodayCents = Math.max(0, capCents - earnedTodayCents);
    const reached = earnedTodayCents >= capCents;
    const availableAt = startOfNextLocalDay().toISOString();

    return {
      capCents,
      earnedTodayCents,
      remainingTodayCents,
      reached,
      resetsAt: availableAt,
      availableAt,
      badge: (user as any).badgeLevel ?? 'STARTER',
    };
  }

  /** Always return all active missions; enrich with canSubmit, reason, availableAt. Do NOT hide when cap reached. */
  async findActiveForUser(userId: number) {
    if (!Number.isFinite(userId) || userId <= 0) {
      throw new BadRequestException('userId invalide');
    }

    const daily = await this.getDailyCapState(userId);
    const { remainingTodayCents, availableAt } = daily;

    const [missions, completedAttempts] = await Promise.all([
      this.prisma.mission.findMany({
        where: {
          status: 'ACTIVE',
          quantityRemaining: { gt: 0 },
          brand: { status: 'ACTIVE' },
        },
        include: {
          brand: true,
          missionType: true,
          attempts: {
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      this.prisma.missionAttempt.findMany({
        where: { userId },
        include: {
          mission: {
            include: { brand: true, missionType: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    ]);

    const missionItems = missions.map((m) => {
      const attemptStatus = m.attempts?.[0]?.status ?? null;
      const attemptId = m.attempts?.[0]?.id ?? null;
      const rewardCents = Number(m.missionType?.userRewardCents ?? 0);
      const alreadyDone = attemptStatus === 'APPROVED' || attemptStatus === 'PENDING';
      const blockedByCap = remainingTodayCents < rewardCents;
      const canSubmit = !alreadyDone && !blockedByCap;
      const reason = !alreadyDone && blockedByCap ? 'DAILY_CAP_REACHED' : undefined;

      return {
        id: m.id,
        missionId: m.id,
        campaignId: m.campaignId ?? undefined,
        title: m.title,
        description: m.description,
        actionUrl: m.actionUrl,
        platform: m.platform ?? undefined,
        rewardCents,
        brand: m.brand
          ? {
              id: m.brand.id,
              name: m.brand.name,
              logoUrl: m.brand.logoUrl,
              coverUrl: m.brand.coverUrl,
            }
          : null,
        type: m.missionType
          ? {
              code: m.missionType.code,
              label: m.missionType.label,
              userRewardCents: m.missionType.userRewardCents,
            }
          : null,
        quantityRemaining: m.quantityRemaining,
        attemptStatus,
        attemptId,
        canSubmit,
        reason,
        availableAt,
      };
    });

    const availableMissions = missionItems.filter((m) => m.attemptStatus == null);
    const completedMissions = completedAttempts.map((a) => ({
      missionId: a.mission.id,
      campaignId: a.mission.campaignId ?? undefined,
      title: a.mission.title,
      description: a.mission.description,
      actionUrl: a.mission.actionUrl,
      platform: a.mission.platform ?? undefined,
      rewardCents: Number(a.mission.missionType?.userRewardCents ?? 0),
      brand: a.mission.brand
        ? { id: a.mission.brand.id, name: a.mission.brand.name, logoUrl: a.mission.brand.logoUrl, coverUrl: a.mission.brand.coverUrl }
        : null,
      attemptId: a.id,
      attemptStatus: a.status,
      submittedAt: a.createdAt.toISOString(),
      reviewedAt: a.reviewedAt?.toISOString() ?? null,
    }));

    return {
      missions: missionItems,
      availableMissions,
      completedMissions,
      daily: {
        ...daily,
        earnedCents: daily.earnedTodayCents,
        remainingCents: daily.remainingTodayCents,
        badgeTier: daily.badge,
      },
      blockedReason: daily.reached ? 'DAILY_CAP_REACHED' : undefined,
      message: daily.reached
        ? 'Tu as atteint ton plafond de gains journalier. Reviens demain pour débloquer de nouvelles missions.'
        : undefined,
    };
  }

  // ✅ User clique “J’ai terminé” => attempt PENDING
  async submitAttempt(userId: number, missionId: number) {
    if (!Number.isFinite(userId) || userId <= 0) throw new BadRequestException('userId invalide');
    if (!Number.isFinite(missionId) || missionId <= 0) throw new BadRequestException('missionId invalide');

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { isBanned: true, bannedReason: true } });
    if (user?.isBanned) {
      throw new ForbiddenException({
        code: 'BANNED',
        message: user.bannedReason ?? 'Compte suspendu.',
      });
    }

    const daily = await this.getDailyCapState(userId);
    const mission = await this.prisma.mission.findUnique({
      where: { id: missionId },
      include: { missionType: true },
    });
    if (!mission) throw new BadRequestException('Mission introuvable');
    if (mission.status !== 'ACTIVE') throw new BadRequestException('Mission indisponible');
    if (mission.quantityRemaining <= 0) throw new BadRequestException('Mission épuisée');
    if (!mission.missionType) throw new BadRequestException('MissionType manquant');

    const userReward = Number(mission.missionType.userRewardCents ?? 0);
    if (!userReward || userReward <= 0) throw new BadRequestException('Reward invalide');

    if (daily.remainingTodayCents < userReward) {
      throw new ConflictException({
        code: 'DAILY_CAP_REACHED',
        message: 'Plafond atteint. Mission disponible demain.',
        availableAt: daily.availableAt,
        capCents: daily.capCents,
        earnedTodayCents: daily.earnedTodayCents,
      });
    }

    const existingAttempt = await this.prisma.missionAttempt.findFirst({
      where: { userId, missionId },
    });
    if (existingAttempt) {
      throw new ConflictException({
        code: 'ALREADY_SUBMITTED',
        message: 'Mission déjà soumise.',
      });
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const brandCost = Number(mission.missionType.brandCostCents ?? 0);

        // Budget marque: créer si absent (nouvelle marque sans recharge), puis vérifier le solde.
        const brandBudget = await tx.brandBudget.upsert({
          where: { brandId: mission.brandId },
          create: {
            brandId: mission.brandId,
            totalDepositedCents: 0,
            reservedForMissionsCents: 0,
            spentCents: 0,
          },
          update: {},
        });
        const remainingBudget =
          Number(brandBudget.totalDepositedCents) -
          Number(brandBudget.reservedForMissionsCents) -
          Number(brandBudget.spentCents);
        if (remainingBudget < brandCost) {
          throw new BadRequestException('Budget marque épuisé');
        }

      const attempt = await tx.missionAttempt.create({
        data: { userId, missionId, status: 'PENDING' },
      });

      // Pas d'incrément de reserved ici: réservé à la création de la mission.

      // 2) Central pool liability (user-side reward only)
      await tx.centralPool.upsert({
        where: { id: 1 },
        create: {
          id: 1,
          totalDepositedCents: 0,
          reservedLiabilityCents: userReward,
          totalSpentCents: 0,
          platformRevenueCents: 0,
        },
        update: { reservedLiabilityCents: { increment: userReward } },
      });

      // 3) User pending wallet (Pocket B) + ledger
      await tx.user.update({
        where: { id: userId },
        data: { pendingCents: { increment: userReward } },
      });

      await tx.walletTransaction.create({
        data: {
          userId,
          type: 'PENDING',
          amountCents: userReward,
          note: `Mission pending: ${mission.title}`,
          missionId: mission.id,
          attemptId: attempt.id,
        },
      });

      return {
        success: true,
        message: 'Demande envoyée ⏳',
        attemptId: attempt.id,
        status: attempt.status,
        userRewardCents: mission.missionType.userRewardCents,
      };
    });
    } catch (e: any) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({
          code: 'ALREADY_SUBMITTED',
          message: 'Mission déjà soumise.',
        });
      }
      throw e;
    }
  }

  async getMyAttempts(userId: number) {
    if (!Number.isFinite(userId) || userId <= 0) throw new BadRequestException('userId invalide');

    const attempts = await this.prisma.missionAttempt.findMany({
      where: { userId },
      include: {
        mission: { include: { brand: true, missionType: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    return {
      attempts: attempts.map((a) => ({
        id: a.id,
        status: a.status,
        createdAt: a.createdAt,
        reviewedAt: a.reviewedAt,
        mission: a.mission
          ? {
              id: a.mission.id,
              title: a.mission.title,
              description: a.mission.description,
              actionUrl: a.mission.actionUrl,
              platform: a.mission.platform ?? undefined,
              rewardCents: a.mission.missionType ? Number(a.mission.missionType.userRewardCents ?? 0) : 0,
              brand: a.mission.brand
                ? { id: a.mission.brand.id, name: a.mission.brand.name, coverUrl: a.mission.brand.coverUrl }
                : null,
              type: a.mission.missionType
                ? {
                    code: a.mission.missionType.code,
                    label: a.mission.missionType.label,
                    userRewardCents: a.mission.missionType.userRewardCents,
                  }
                : null,
            }
          : null,
      })),
    };
  }
}