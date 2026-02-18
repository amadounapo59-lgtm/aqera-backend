import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

function startOfLocalDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfNextLocalDay(d = new Date()) {
  const x = startOfLocalDay(d);
  x.setDate(x.getDate() + 1);
  return x;
}

@Injectable()
export class MissionsService {
  constructor(private readonly prisma: PrismaService) {}

  private async getDailyCapState(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('Utilisateur introuvable');

    // ✅ cap stocké sur le user (10$ par défaut via prisma schema)
    const capCents = Number(user.dailyCapCents ?? 1000);

    const dayStart = startOfLocalDay();
    const dayEnd = startOfNextLocalDay();

    // ✅ On calcule le “gagné aujourd’hui” via le ledger
    // On ne compte que les crédits liés à des missions (missionId != null)
    const agg = await this.prisma.walletTransaction.aggregate({
      where: {
        userId,
        type: 'CREDIT',
        missionId: { not: null },
        createdAt: { gte: dayStart, lt: dayEnd },
      },
      _sum: { amountCents: true },
    });

    const earnedCents = Number(agg._sum.amountCents ?? 0);
    const remainingCents = Math.max(0, capCents - earnedCents);
    const reached = earnedCents >= capCents;

    return {
      capCents,
      earnedCents,
      remainingCents,
      reached,
      resetsAt: dayEnd.toISOString(),
      badge: (user as any).badge ?? 'STARTER',
    };
  }

  // ✅ Missions actives + attempt status du user
  async findActiveForUser(userId: number) {
    if (!Number.isFinite(userId) || userId <= 0) {
      throw new BadRequestException('userId invalide');
    }

    const daily = await this.getDailyCapState(userId);

    // ✅ Si plafond atteint => aucune mission dispo (message côté app)
    if (daily.reached) {
      return {
        missions: [],
        daily,
        blockedReason: 'DAILY_CAP_REACHED',
        message:
          'Tu as atteint ton plafond de gains journalier. Reviens demain pour débloquer de nouvelles missions.',
      };
    }

    const missions = await this.prisma.mission.findMany({
      where: { status: 'ACTIVE', quantityRemaining: { gt: 0 } },
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
    });

    // ✅ Option “pro” : filtrer les missions qui dépassent le reste du cap
    const filtered = missions.filter((m) => {
      const reward = m.missionType?.userRewardCents ?? 0;
      return Number(reward) > 0 && Number(reward) <= daily.remainingCents;
    });

    return {
      missions: filtered.map((m) => ({
        id: m.id,
        title: m.title,
        description: m.description,
        actionUrl: m.actionUrl,
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
        attemptStatus: m.attempts?.[0]?.status ?? null,
        attemptId: m.attempts?.[0]?.id ?? null,
      })),
      daily,
    };
  }

  // ✅ User clique “J’ai terminé” => attempt PENDING
  async submitAttempt(userId: number, missionId: number) {
    if (!Number.isFinite(userId) || userId <= 0) throw new BadRequestException('userId invalide');
    if (!Number.isFinite(missionId) || missionId <= 0) throw new BadRequestException('missionId invalide');

    // ✅ Block si plafond atteint
    const daily = await this.getDailyCapState(userId);
    if (daily.reached) {
      throw new BadRequestException(
        `Plafond journalier atteint (${(daily.capCents / 100).toFixed(2)}$). Reviens demain pour de nouvelles missions.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const mission = await tx.mission.findUnique({
        where: { id: missionId },
        include: { missionType: true },
      });

      if (!mission) throw new BadRequestException('Mission introuvable');
      if (mission.status !== 'ACTIVE') throw new BadRequestException('Mission indisponible');
      if (mission.quantityRemaining <= 0) throw new BadRequestException('Mission épuisée');
      if (!mission.missionType) throw new BadRequestException('MissionType manquant');

      // ✅ Bloquer si reward dépasse le cap restant
      const reward = Number(mission.missionType.userRewardCents ?? 0);
      if (!reward || reward <= 0) throw new BadRequestException('Reward invalide');
      if (reward > daily.remainingCents) {
        throw new BadRequestException(
          `Plafond journalier: il te reste ${(daily.remainingCents / 100).toFixed(
            2,
          )}$ aujourd’hui. Cette mission donne ${(reward / 100).toFixed(2)}$.`,
        );
      }

      const alreadyApproved = await tx.missionAttempt.findFirst({
        where: { userId, missionId, status: 'APPROVED' },
      });
      if (alreadyApproved) throw new BadRequestException('Mission déjà approuvée (bloquée)');

      const pending = await tx.missionAttempt.findFirst({
        where: { userId, missionId, status: 'PENDING' },
      });
      if (pending) {
        return {
          success: true,
          message: 'Déjà en attente ⏳',
          attemptId: pending.id,
          status: pending.status,
        };
      }

      // ✅ Budget marque (locked) -> on réserve au moment de la soumission
      const brandBudget = await tx.brandBudget.findUnique({ where: { brandId: mission.brandId } });
      if (!brandBudget) {
        throw new BadRequestException('Budget marque non configuré (admin)');
      }
      const remainingBudget =
        Number(brandBudget.totalDepositedCents) -
        Number(brandBudget.reservedForMissionsCents) -
        Number(brandBudget.spentCents);
      if (remainingBudget < reward) {
        throw new BadRequestException('Budget marque épuisé');
      }

      const attempt = await tx.missionAttempt.create({
        data: { userId, missionId, status: 'PENDING' },
      });

      // 1) Reserve brand budget
      await tx.brandBudget.update({
        where: { brandId: mission.brandId },
        data: { reservedForMissionsCents: { increment: reward } },
      });

      // 2) Central pool liability (sum pending + available)
      await tx.centralPool.upsert({
        where: { id: 1 },
        create: { id: 1, totalDepositedCents: 0, reservedLiabilityCents: reward, totalSpentCents: 0 },
        update: { reservedLiabilityCents: { increment: reward } },
      });

      // 3) User pending wallet (Pocket B)
      await tx.user.update({
        where: { id: userId },
        data: { pendingCents: { increment: reward } },
      });

      // 4) Ledger entry (pending)
      await tx.walletTransaction.create({
        data: {
          userId,
          type: 'PENDING',
          amountCents: reward,
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