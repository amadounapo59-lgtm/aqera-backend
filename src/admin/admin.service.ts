import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { DailyMetricsService } from '../analytics/daily-metrics.service';
import { ScoreService } from '../analytics/score.service';
import { SecurityEventService } from '../security/security-event.service';
import { EventNames } from '../analytics/events';
import { chunk, IN_CLAUSE_CHUNK_SIZE } from '../common/utils/chunk';
import * as bcrypt from 'bcryptjs';

function normalizeEmail(email: string) {
  return (email ?? '').trim().toLowerCase();
}

function makeSlug(name: string) {
  return (name ?? '')
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function generateTempPassword() {
  // Simple & efficace MVP (min 10 chars)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$';
  let out = '';
  for (let i = 0; i < 12; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

const BRAND_CATEGORIES = ['RESTAURANT', 'CAFE', 'BARBER', 'BOUTIQUE', 'BEAUTE', 'VOYAGE', 'SANTE', 'DIVERTISSEMENT', 'SERVICES', 'MODE'] as const;
function mapApplicationCategoryToBrand(appCategory: string | null | undefined): string {
  const u = (appCategory ?? '').trim().toUpperCase().replace(/[^A-ZÉ]/g, '');
  if (BRAND_CATEGORIES.includes(u as any)) return u;
  if (u.includes('RESTAURANT') || u === 'RESTAURANTS') return 'RESTAURANT';
  if (u.includes('CAFE') || u === 'CAFES') return 'CAFE';
  if (u.includes('BARBER') || u.includes('BARBIER')) return 'BARBER';
  if (u.includes('BOUTIQUE')) return 'BOUTIQUE';
  if (u.includes('BEAUTE') || u.includes('BEAUTÉ')) return 'BEAUTE';
  if (u.includes('VOYAGE')) return 'VOYAGE';
  if (u.includes('SANTE') || u.includes('SANTÉ')) return 'SANTE';
  if (u.includes('DIVERTISSEMENT')) return 'DIVERTISSEMENT';
  if (u.includes('SERVICE')) return 'SERVICES';
  if (u.includes('MODE')) return 'MODE';
  return 'RESTAURANT';
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly analyticsService: AnalyticsService,
    private readonly dailyMetricsService: DailyMetricsService,
    private readonly scoreService: ScoreService,
    private readonly securityEvents: SecurityEventService,
  ) {}

  private async assertAdminById(adminUserId: number) {
    if (!Number.isFinite(adminUserId) || adminUserId <= 0) {
      throw new BadRequestException('adminUserId invalide');
    }

    const admin = await this.prisma.user.findUnique({ where: { id: adminUserId } });
    if (!admin) throw new NotFoundException('Admin introuvable');

    if ((admin.role || '').toUpperCase() !== 'ADMIN') {
      throw new ForbiddenException('Accès refusé (ADMIN uniquement)');
    }
    return admin;
  }

  // ---------------------------
  // ✅ Mission Attempts (ADMIN)
  // ---------------------------

  async listAttempts(status?: string) {
    const st = (status ? status.toUpperCase() : 'PENDING') as any;

    const attempts = await this.prisma.missionAttempt.findMany({
      where: { status: st },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        user: { select: { id: true, email: true, name: true } },
        mission: { include: { brand: true, missionType: true } },
      },
    });

    return { attempts };
  }

  // ---------------------------
  // Missions à approuver (PENDING_APPROVAL → ACTIVE / REJECTED)
  // ---------------------------

  async listMissions(adminUserId: number, status?: string) {
    await this.assertAdminById(adminUserId);
    const st = (status ?? 'PENDING_APPROVAL').toUpperCase();

    const missions = await this.prisma.mission.findMany({
      where: { status: st },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        brand: { select: { id: true, name: true, logoUrl: true } },
        missionType: { select: { id: true, code: true, label: true, userRewardCents: true, brandCostCents: true } },
      },
    });

    return { missions };
  }

  async approveMission(adminUserId: number, missionId: number) {
    await this.assertAdminById(adminUserId);
    const id = Number(missionId);
    if (!Number.isFinite(id) || id <= 0) throw new BadRequestException('missionId invalide');

    const mission = await this.prisma.mission.findUnique({ where: { id } });
    if (!mission) throw new NotFoundException('Mission introuvable');
    if (mission.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException(`Mission déjà traitée (statut: ${mission.status})`);
    }

    await this.prisma.mission.update({
      where: { id },
      data: { status: 'ACTIVE' },
    });

    return { success: true, message: 'Mission approuvée. Elle est maintenant visible côté utilisateurs.' };
  }

  async rejectMission(adminUserId: number, missionId: number) {
    await this.assertAdminById(adminUserId);
    const id = Number(missionId);
    if (!Number.isFinite(id) || id <= 0) throw new BadRequestException('missionId invalide');

    const mission = await this.prisma.mission.findUnique({ where: { id } });
    if (!mission) throw new NotFoundException('Mission introuvable');
    if (mission.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException(`Mission déjà traitée (statut: ${mission.status})`);
    }

    await this.prisma.mission.update({
      where: { id },
      data: { status: 'REJECTED' },
    });

    return { success: true, message: 'Mission refusée.' };
  }

  // ---------------------------
  // GET /admin/stats — KPIs MVP
  // ---------------------------
  async getStats(adminUserId: number) {
    await this.assertAdminById(adminUserId);

    const now = new Date();
    const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const since30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      usersTotal,
      usersActive7d,
      usersActive30d,
      attemptsByStatus,
      creditAgg,
      debitAgg,
      purchasesByStatus,
      brandsWithCounts,
      missionsWithAttempts,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { lastActiveAt: { gte: since7d } } }),
      this.prisma.user.count({ where: { lastActiveAt: { gte: since30d } } }),
      this.prisma.missionAttempt.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.walletTransaction.aggregate({
        where: { type: 'CREDIT' },
        _sum: { amountCents: true },
      }),
      this.prisma.walletTransaction.aggregate({
        where: { type: 'DEBIT' },
        _sum: { amountCents: true },
      }),
      this.prisma.giftCardPurchase.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.mission.groupBy({
        by: ['brandId'],
        _count: { _all: true },
      }),
      this.prisma.missionAttempt.groupBy({
        by: ['missionId'],
        _count: { _all: true },
      }),
    ]);

    const attempts: Record<string, number> = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
    for (const row of attemptsByStatus) {
      attempts[row.status] = row._count._all;
    }

    const giftCardPurchases: Record<string, number> = { ACTIVE: 0, USED: 0 };
    for (const row of purchasesByStatus) {
      giftCardPurchases[row.status] = row._count._all;
    }

    const brandIds = brandsWithCounts
      .sort((a, b) => b._count._all - a._count._all)
      .slice(0, 10)
      .map((b) => b.brandId);
    const brands = brandIds.length
      ? await this.prisma.brand.findMany({
          where: { id: { in: brandIds } },
          select: { id: true, name: true },
        })
      : [];
    const brandMap = new Map(brands.map((b) => [b.id, b.name]));
    const countByBrandId = new Map(brandsWithCounts.map((b) => [b.brandId, b._count._all]));
    const topBrands = brandIds.map((brandId) => ({
      brandId,
      brandName: brandMap.get(brandId) ?? '—',
      missionsCount: countByBrandId.get(brandId) ?? 0,
    }));

    const missionIds = missionsWithAttempts
      .sort((a, b) => b._count._all - a._count._all)
      .slice(0, 10)
      .map((m) => m.missionId);
    const missions =
      missionIds.length > 0
        ? await this.prisma.mission.findMany({
            where: { id: { in: missionIds } },
            include: { brand: { select: { name: true } } },
          })
        : [];
    const missionMap = new Map(missions.map((m) => [m.id, { title: m.title, brandName: m.brand?.name ?? '—' }]));
    const countByMissionId = new Map(missionsWithAttempts.map((m) => [m.missionId, m._count._all]));
    const topMissions = missionIds.map((missionId) => ({
      missionId,
      title: missionMap.get(missionId)?.title ?? '—',
      brandName: missionMap.get(missionId)?.brandName ?? '—',
      attemptsCount: countByMissionId.get(missionId) ?? 0,
    }));

    return {
      users: {
        total: usersTotal,
        active7d: usersActive7d,
        active30d: usersActive30d,
      },
      attempts: {
        PENDING: attempts.PENDING,
        APPROVED: attempts.APPROVED,
        REJECTED: attempts.REJECTED,
      },
      cashback: {
        distributedCents: Number(creditAgg._sum.amountCents ?? 0),
        spentCents: Number(debitAgg._sum.amountCents ?? 0),
      },
      giftCardPurchases: {
        ACTIVE: giftCardPurchases.ACTIVE,
        USED: giftCardPurchases.USED,
      },
      topBrands,
      topMissions,
    };
  }

  async approveAttempt(adminUserId: number, attemptId: number) {
    const admin = await this.assertAdminById(adminUserId);

    if (!Number.isFinite(attemptId) || attemptId <= 0) {
      throw new BadRequestException('attemptId invalide');
    }

    // IMPORTANT: évite d’appeler WalletService (transaction) À L’INTÉRIEUR d’une autre transaction
    // => on fait une seule transaction ici, et on crédite wallet dans la même tx
    return this.prisma.$transaction(async (tx) => {
      const attempt = await tx.missionAttempt.findUnique({
        where: { id: attemptId },
        include: { mission: { include: { missionType: true } } },
      });

      if (!attempt) throw new NotFoundException('Attempt introuvable');
      if (attempt.status !== 'PENDING') throw new BadRequestException('Attempt non-PENDING');

      const mission = attempt.mission;
      if (!mission) throw new NotFoundException('Mission introuvable');
      if (mission.status !== 'ACTIVE') throw new BadRequestException('Mission non ACTIVE');
      if (mission.quantityRemaining <= 0) throw new BadRequestException('Mission épuisée');

      const reward = Number(mission.missionType?.userRewardCents ?? 0);
      const brandCost = Number(mission.missionType?.brandCostCents ?? 0);
      if (!Number.isFinite(reward) || reward <= 0) throw new BadRequestException('Reward invalide');

      // 1) approve
      await tx.missionAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'APPROVED',
          reviewedAt: new Date(),
          reviewedByUserId: admin.id,
        },
      });

      // 2) decrement mission stock
      await tx.mission.update({
        where: { id: mission.id },
        data: { quantityRemaining: { decrement: 1 } },
      });

      // 3) Unlock pending -> available (pro flow)
      // - Pending was created at submit time (missions.service.ts)
      // - This creates the CREDIT ledger entry + updates badge/daily stats
      const updatedUser = await this.walletService.unlockPendingToAvailableTx(
        tx,
        attempt.userId,
        Number(reward),
        `Mission approved: ${mission.title}`,
        mission.id,
        attempt.id,
      );

      // 4) Brand budget + central pool (reservedLiability = brand reserved + user pending+available)
      if (Number.isFinite(brandCost) && brandCost > 0) {
        const fee = Math.max(0, brandCost - reward);

        await tx.brandBudget.updateMany({
          where: { brandId: mission.brandId },
          data: {
            reservedForMissionsCents: { decrement: brandCost },
            spentCents: { increment: brandCost },
          },
        });

        // reservedLiability = brand reserved + user (pending+available); on approve only brand reserved decreases by cost
        await tx.centralPool.upsert({
          where: { id: 1 },
          create: {
            id: 1,
            totalDepositedCents: 0,
            reservedLiabilityCents: 0,
            totalSpentCents: brandCost,
            platformRevenueCents: fee,
            platformMarginCents: 0,
            platformAvailableCents: 0,
            platformSpentCents: 0,
          },
          update: {
            totalSpentCents: { increment: brandCost },
            platformRevenueCents: { increment: fee },
            reservedLiabilityCents: { decrement: brandCost },
          },
        });
      }

      return {
        success: true,
        message: 'Attempt approuvé ✅',
        creditedCents: Number(reward),
        balanceCents: updatedUser.balanceCents,
        creditedUserId: attempt.userId,
      };
    });
  }

  async rejectAttempt(adminUserId: number, attemptId: number) {
    const admin = await this.assertAdminById(adminUserId);

    if (!Number.isFinite(attemptId) || attemptId <= 0) {
      throw new BadRequestException('attemptId invalide');
    }

      const attempt = await this.prisma.missionAttempt.findUnique({
        where: { id: attemptId },
        include: { mission: { include: { missionType: true } } },
      });
    if (!attempt) throw new NotFoundException('Attempt introuvable');
    if (attempt.status !== 'PENDING') throw new BadRequestException('Attempt non-PENDING');

    // On annule : libérer la réserve + retirer le pending du user
    const updated = await this.prisma.$transaction(async (tx) => {
      const full = await tx.missionAttempt.findUnique({
        where: { id: attemptId },
        include: { mission: { include: { missionType: true } } },
      });
      if (!full) throw new NotFoundException('Attempt introuvable');
      if (full.status !== 'PENDING') throw new BadRequestException('Attempt non-PENDING');

      const reward = Number(full.mission?.missionType?.userRewardCents ?? 0);
      const brandCost = Number(full.mission?.missionType?.brandCostCents ?? 0);

      const attemptUpd = await tx.missionAttempt.update({
        where: { id: attemptId },
        data: {
          status: 'REJECTED',
          reviewedAt: new Date(),
          reviewedByUserId: admin.id,
        },
      });

      if (reward > 0 && full.mission?.brandId) {
        await tx.user.update({
          where: { id: full.userId },
          data: { pendingCents: { decrement: reward } },
        });

        await tx.walletTransaction.create({
          data: {
            userId: full.userId,
            type: 'ADJUST',
            amountCents: Number(reward),
            note: `Mission rejected: ${full.mission.title}`,
            missionId: full.missionId,
            attemptId: full.id,
          },
        });

        // Release full brand cost reservation + liability
        const costToRelease = brandCost > 0 ? brandCost : reward;

        await tx.brandBudget.updateMany({
          where: { brandId: full.mission.brandId },
          data: { reservedForMissionsCents: { decrement: costToRelease } },
        });

        await tx.centralPool.updateMany({
          where: { id: 1 },
          data: { reservedLiabilityCents: { decrement: reward } },
        });
      }

      return attemptUpd;
    });

    return { success: true, message: 'Attempt refusé ❌', attempt: updated };
  }

  // ---------------------------
  // Comptes marque : liste, suspendre, supprimer
  // ---------------------------

  async listBrands(adminUserId: number, opts?: { status?: string; page?: number; limit?: number }) {
    await this.assertAdminById(adminUserId);
    const st = (opts?.status ?? '').toUpperCase() || undefined;
    const page = Math.max(1, opts?.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts?.limit ?? 20));
    const skip = (page - 1) * limit;

    const [brands, total] = await Promise.all([
      this.prisma.brand.findMany({
        where: st ? { status: st } : undefined,
        orderBy: { name: 'asc' },
        skip,
        take: limit,
        include: {
          users: { select: { id: true, email: true, name: true, createdAt: true } },
          _count: { select: { missions: true, giftCards: true } },
        },
      }),
      this.prisma.brand.count({ where: st ? { status: st } : undefined }),
    ]);

    return {
      brands: brands.map((b) => ({
        id: b.id,
        name: b.name,
        slug: b.slug,
        status: b.status ?? 'ACTIVE',
        logoUrl: b.logoUrl,
        users: b.users,
        missionsCount: b._count.missions,
        giftCardsCount: b._count.giftCards,
        createdAt: b.createdAt,
      })),
      total,
      page,
      limit,
    };
  }

  async suspendBrand(adminUserId: number, brandId: number) {
    await this.assertAdminById(adminUserId);
    if (!Number.isFinite(brandId) || brandId <= 0) throw new BadRequestException('brandId invalide');

    const brand = await this.prisma.brand.findUnique({ where: { id: brandId } });
    if (!brand) throw new NotFoundException('Marque introuvable');
    if (brand.status === 'SUSPENDED') {
      return { success: true, message: 'Marque déjà suspendue.' };
    }

    await this.prisma.brand.update({
      where: { id: brandId },
      data: { status: 'SUSPENDED' },
    });
    return { success: true, message: 'Compte marque suspendu.' };
  }

  async deleteBrand(adminUserId: number, brandId: number) {
    await this.assertAdminById(adminUserId);
    if (!Number.isFinite(brandId) || brandId <= 0) throw new BadRequestException('brandId invalide');

    const brand = await this.prisma.brand.findUnique({
      where: { id: brandId },
      include: { users: { select: { id: true } } },
    });
    if (!brand) throw new NotFoundException('Marque introuvable');

    await this.prisma.$transaction(async (tx) => {
      await tx.brand.update({
        where: { id: brandId },
        data: { status: 'DELETED' },
      });
      for (const u of brand.users) {
        await tx.user.update({
          where: { id: u.id },
          data: { passwordHash: null },
        });
      }
    });
    return { success: true, message: 'Compte marque supprimé. Les utilisateurs liés ne peuvent plus se connecter.' };
  }

  async reactivateBrand(adminUserId: number, brandId: number) {
    await this.assertAdminById(adminUserId);
    if (!Number.isFinite(brandId) || brandId <= 0) throw new BadRequestException('brandId invalide');

    const brand = await this.prisma.brand.findUnique({ where: { id: brandId } });
    if (!brand) throw new NotFoundException('Marque introuvable');

    await this.prisma.brand.update({
      where: { id: brandId },
      data: { status: 'ACTIVE' },
    });
    return { success: true, message: 'Marque réactivée.' };
  }

  // ---------------------------
  // ✅ Brand Applications (ADMIN)
  // ---------------------------

  async listBrandApplications(status?: string) {
    const st = (status ? status.toUpperCase() : 'PENDING') as any;

    const items = await this.prisma.brandApplication.findMany({
      where: { status: st },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    return { items };
  }

  async approveBrandApplication(adminUserId: number, applicationId: number) {
    const admin = await this.assertAdminById(adminUserId);
    if (!Number.isFinite(applicationId) || applicationId <= 0) {
      throw new BadRequestException('applicationId invalide');
    }

    const app = await this.prisma.brandApplication.findUnique({ where: { id: applicationId } });
    if (!app) throw new NotFoundException('Application introuvable');
    if (app.status !== 'PENDING') throw new BadRequestException('Application non-PENDING');

    const email = normalizeEmail(app.email);
    if (!email) throw new BadRequestException('Email application invalide');

    // créer brand + user brand (temp password)
    const tempPassword = generateTempPassword();
    const hash = await bcrypt.hash(tempPassword, 10);

    const brandName = app.businessName?.trim();
    if (!brandName) throw new BadRequestException('businessName manquant');

    const baseSlug = makeSlug(brandName) || 'brand';
    const slug = `${baseSlug}-${applicationId}`;

    const result = await this.prisma.$transaction(async (tx) => {
      const brand = await tx.brand.create({
        data: {
          name: brandName,
          slug,
          website: app.website ?? null,
          description: app.notes ?? null,
          category: mapApplicationCategoryToBrand(app.category ?? undefined),
        },
      });

      // si un user existe déjà avec cet email -> erreur claire
      const existingUser = await tx.user.findUnique({ where: { email } });
      if (existingUser) throw new BadRequestException('Un utilisateur existe déjà avec cet email');

      const user = await tx.user.create({
        data: {
          email,
          name: brandName,
          role: 'BRAND',
          brandId: brand.id,
          passwordHash: hash,
          mustChangePassword: true,
          tempPasswordIssuedAt: new Date(),
          balanceCents: 0,
        },
        select: { id: true, email: true, role: true, brandId: true, mustChangePassword: true },
      });

      await tx.brandApplication.update({
        where: { id: app.id },
        data: {
          status: 'APPROVED' as any,
          reviewedAt: new Date(),
          reviewedById: admin.id,
          brandId: brand.id,
        },
      });

      // Créer le budget marque (initial si indiqué dans la demande)
      const initialCents = Math.max(0, Number((app as any).initialBudgetCents ?? 0));
      await tx.brandBudget.create({
        data: {
          brandId: brand.id,
          totalDepositedCents: initialCents,
          reservedForMissionsCents: 0,
          spentCents: 0,
        },
      });

      return { brand, user };
    });

    // ✅ temp password retourné seulement à l’ADMIN (toi)
    return {
      success: true,
      message: 'Marque approuvée ✅',
      brandId: result.brand.id,
      brandName: result.brand.name,
      brandSlug: result.brand.slug,
      brandUserEmail: result.user.email,
      tempPassword, // à envoyer à la marque
    };
  }

  async rejectBrandApplication(adminUserId: number, applicationId: number) {
    const admin = await this.assertAdminById(adminUserId);
    if (!Number.isFinite(applicationId) || applicationId <= 0) {
      throw new BadRequestException('applicationId invalide');
    }

    const app = await this.prisma.brandApplication.findUnique({ where: { id: applicationId } });
    if (!app) throw new NotFoundException('Application introuvable');
    if (app.status !== 'PENDING') throw new BadRequestException('Application non-PENDING');

    const updated = await this.prisma.brandApplication.update({
      where: { id: applicationId },
      data: {
        status: 'REJECTED' as any,
        reviewedAt: new Date(),
        reviewedById: admin.id,
      },
    });

    return { success: true, message: 'Application refusée ❌', item: updated };
  }

  // ---------------------------
  // Agency applications
  // ---------------------------

  async listAgencyApplications(status?: string) {
    const s = (status ?? '').trim().toUpperCase();
    const where: any = {};
    if (s) where.status = s;

    const applications = await this.prisma.agencyApplication.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    return { applications };
  }

  async approveAgencyApplication(adminUserId: number, applicationId: number) {
    this.assertId(adminUserId, 'adminUserId');
    this.assertId(applicationId, 'applicationId');

    const app = await this.prisma.agencyApplication.findUnique({ where: { id: applicationId } });
    if (!app) throw new BadRequestException('Demande introuvable');
    if (app.status !== 'PENDING') throw new BadRequestException('Demande déjà traitée');

    const normalizedEmail = this.normalizeEmail(app.email);

    const existingUser = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) throw new BadRequestException('Un compte existe déjà avec cet email');

    const tempPassword = this.makeTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    const result = await this.prisma.$transaction(async (tx) => {
      const agency = await tx.agency.create({
        data: {
          name: app.agencyName,
          slug: makeSlug(app.agencyName) + "-" + applicationId,
          email: normalizedEmail,
          website: app.website ?? null,
          instagram: app.instagram ?? null,
          subscriptionStatus: 'TRIALING',
          trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          plan: 'STARTER',
        },
      });

      const user = await tx.user.create({
        data: {
          email: normalizedEmail,
          name: app.contactName?.trim() || app.agencyName,
          passwordHash,
          role: 'AGENCY',
          agencyId: agency.id,
          mustChangePassword: true,
          tempPasswordExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
        select: { id: true, email: true, role: true, agencyId: true },
      });

      await tx.agencyApplication.update({
        where: { id: applicationId },
        data: {
          status: 'APPROVED',
          reviewedAt: new Date(),
          reviewedById: adminUserId,
          agencyId: agency.id,
        },
      });

      return { agency, user };
    });

    return {
      success: true,
      message: 'Agence approuvée ✅',
      agencyUserEmail: result.user.email,
      tempPassword,
    };
  }

  async rejectAgencyApplication(adminUserId: number, applicationId: number) {
    this.assertId(adminUserId, 'adminUserId');
    this.assertId(applicationId, 'applicationId');

    const app = await this.prisma.agencyApplication.findUnique({ where: { id: applicationId } });
    if (!app) throw new BadRequestException('Demande introuvable');
    if (app.status !== 'PENDING') throw new BadRequestException('Demande déjà traitée');

    await this.prisma.agencyApplication.update({
      where: { id: applicationId },
      data: {
        status: 'REJECTED',
        reviewedAt: new Date(),
        reviewedById: adminUserId,
      },
    });

    return { success: true, message: 'Demande refusée ✅' };
  }


  // ---------------------------
  // ✅ GiftCard Inventory (ADMIN)
  // ---------------------------

  async importGiftCardInventory(
    adminUserId: number,
    payload: { brandId: number; valueCents: number; codes: string[] },
  ) {
    await this.assertAdminById(adminUserId);

    const brandId = Number(payload?.brandId);
    const valueCents = Number(payload?.valueCents);
    const rawCodes = (payload?.codes ?? []).map((c) => String(c).trim().toUpperCase()).filter(Boolean);
    const codes = [...new Set(rawCodes)];
    if (codes.length === 0) throw new BadRequestException('codes requis');

    const brand = await this.prisma.brand.findUnique({ where: { id: brandId } });
    if (!brand) throw new NotFoundException('Brand introuvable');

    const gift = await this.prisma.giftCard.upsert({
      where: { uniq_brand_value: { brandId, valueCents } },
      update: {},
      create: { brandId, valueCents },
    });

    let insertedCount = 0;
    let skippedCount = 0;
    for (const code of codes) {
      const existing = await this.prisma.giftCardInventoryItem.findUnique({ where: { code } });
      if (existing) {
        skippedCount++;
        continue;
      }
      await this.prisma.giftCardInventoryItem.create({
        data: { giftCardId: gift.id, code },
      });
      insertedCount++;
    }

    if (insertedCount > 0) {
      await this.prisma.brandBudget.upsert({
        where: { brandId },
        create: { brandId, totalDepositedCents: valueCents * insertedCount },
        update: { totalDepositedCents: { increment: valueCents * insertedCount } },
      });
    }

    return {
      success: true,
      brandId,
      giftCardId: gift.id,
      insertedCount,
      skippedCount,
      received: codes.length,
    };
  }

  /** Import codes by giftCardId (Option 1 spec). Rejects empty, dedupes, skip existing. */
  async importGiftCardCodes(
    adminUserId: number,
    payload: { giftCardId: number; codes: string[] },
  ) {
    await this.assertAdminById(adminUserId);

    const giftCardId = Number(payload?.giftCardId);
    const rawCodes = (payload?.codes ?? []).map((c) => String(c).trim().toUpperCase()).filter(Boolean);
    const codes = [...new Set(rawCodes)];
    if (!Number.isFinite(giftCardId) || giftCardId <= 0) throw new BadRequestException('giftCardId invalide');
    if (codes.length === 0) throw new BadRequestException('codes requis');

    const gift = await this.prisma.giftCard.findUnique({
      where: { id: giftCardId },
      include: { brand: true },
    });
    if (!gift) throw new NotFoundException('GiftCard introuvable');

    let insertedCount = 0;
    let skippedCount = 0;
    for (const code of codes) {
      const existing = await this.prisma.giftCardInventoryItem.findUnique({ where: { code } });
      if (existing) {
        skippedCount++;
        continue;
      }
      await this.prisma.giftCardInventoryItem.create({
        data: { giftCardId: gift.id, code },
      });
      insertedCount++;
    }

    if (insertedCount > 0) {
      await this.prisma.brandBudget.upsert({
        where: { brandId: gift.brandId },
        create: { brandId: gift.brandId, totalDepositedCents: gift.valueCents * insertedCount },
        update: { totalDepositedCents: { increment: gift.valueCents * insertedCount } },
      });
    }

    return {
      success: true,
      giftCardId: gift.id,
      insertedCount,
      skippedCount,
      received: codes.length,
    };
  }

  async getGiftCardInventorySummary(adminUserId: number, brandId?: number) {
    await this.assertAdminById(adminUserId);

    const whereBrand = brandId ? { brandId: Number(brandId) } : {};

    const giftCards = await this.prisma.giftCard.findMany({
      where: whereBrand,
      include: { brand: true, inventory: true },
      orderBy: [{ brandId: 'asc' }, { valueCents: 'asc' }],
      take: 200,
    });

    const summary = giftCards.map((g) => {
      const counts = g.inventory.reduce(
        (acc: any, it: any) => {
          acc[it.status] = (acc[it.status] ?? 0) + 1;
          return acc;
        },
        { AVAILABLE: 0, ISSUED: 0, USED: 0, VOID: 0 },
      );
      const total = g.inventory.length;
      return {
        giftCardId: g.id,
        brandId: g.brandId,
        brandName: g.brand.name,
        valueCents: g.valueCents,
        availableCount: counts.AVAILABLE,
        reservedCount: counts.ISSUED,
        usedCount: counts.USED,
        voidCount: counts.VOID,
        total,
        ...counts,
      };
    });

    return { summary };
  }

  /** Alias for codes/summary (Option 1 spec): by brand + value, same shape. */
  async getGiftCardCodesSummary(adminUserId: number, brandId?: number) {
    return this.getGiftCardInventorySummary(adminUserId, brandId);
  }

  /** List codes with pagination and filters (debug). */
  async listGiftCardCodes(
    adminUserId: number,
    opts: { giftCardId?: number; status?: string; page?: number; limit?: number },
  ) {
    await this.assertAdminById(adminUserId);

    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
    const skip = (page - 1) * limit;

    const where: any = {};
    if (opts.giftCardId != null) where.giftCardId = Number(opts.giftCardId);
    if (opts.status != null && opts.status.trim()) {
      const s = opts.status.trim().toUpperCase();
      if (['AVAILABLE', 'ISSUED', 'USED', 'VOID'].includes(s)) where.status = s;
    }

    const [items, total] = await Promise.all([
      this.prisma.giftCardInventoryItem.findMany({
        where,
        orderBy: { id: 'asc' },
        skip,
        take: limit,
        include: { giftCard: { include: { brand: { select: { name: true } } } } },
      }),
      this.prisma.giftCardInventoryItem.count({ where }),
    ]);

    return {
      codes: items.map((it) => ({
        id: it.id,
        giftCardId: it.giftCardId,
        code: it.code,
        status: it.status,
        issuedAt: it.issuedAt,
        usedAt: it.usedAt,
        purchaseId: it.purchaseId,
        createdAt: it.createdAt,
        brandName: (it as any).giftCard?.brand?.name,
        valueCents: (it as any).giftCard?.valueCents,
      })),
      total,
      page,
      limit,
    };
  }

  /** Void a code (status -> VOID). */
  async voidGiftCardCode(adminUserId: number, codeId: number) {
    await this.assertAdminById(adminUserId);

    const item = await this.prisma.giftCardInventoryItem.findUnique({ where: { id: codeId } });
    if (!item) throw new NotFoundException('Code introuvable');
    if (item.status === 'USED') throw new BadRequestException('Code déjà utilisé');
    if (item.status === 'VOID') return { success: true, status: 'VOID', message: 'Déjà désactivé' };

    await this.prisma.giftCardInventoryItem.update({
      where: { id: codeId },
      data: { status: 'VOID', updatedAt: new Date() },
    });
    return { success: true, status: 'VOID' };
  }

  // ---------------------------
  // AQERA Platform budget & campaigns
  // ---------------------------

  async getPlatformBudget(adminUserId: number) {
    await this.assertAdminById(adminUserId);
    const pool = await this.prisma.centralPool.findUnique({ where: { id: 1 } });
    if (!pool) {
      return {
        platformAvailableCents: 0,
        platformMarginCents: 0,
        platformSpentCents: 0,
      };
    }
    return {
      platformAvailableCents: Number((pool as any).platformAvailableCents ?? 0),
      platformMarginCents: Number((pool as any).platformMarginCents ?? 0),
      platformSpentCents: Number((pool as any).platformSpentCents ?? 0),
    };
  }

  async getDailyMetrics(adminUserId: number, from: string, to: string) {
    await this.assertAdminById(adminUserId);
    return this.dailyMetricsService.getDailyRange(from, to);
  }

  async getRiskUsers(adminUserId: number, limit: number) {
    await this.assertAdminById(adminUserId);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [submitsLastHourRows, attemptReviews, submitTimes] = await Promise.all([
      this.prisma.eventLog.groupBy({
        by: ['userId'],
        where: {
          eventName: EventNames.mission_submit_success,
          createdAt: { gte: oneHourAgo },
          userId: { not: null },
        },
        _count: { userId: true },
      }),
      this.prisma.missionAttempt.findMany({
        where: {
          reviewedAt: { gte: sevenDaysAgo },
          status: { in: ['APPROVED', 'REJECTED'] },
        },
        select: { userId: true, status: true },
      }),
      this.prisma.eventLog.findMany({
        where: {
          eventName: EventNames.mission_submit_success,
          createdAt: { gte: sevenDaysAgo },
          userId: { not: null },
        },
        select: { userId: true, metadata: true },
      }),
    ]);

    const submitsLastHourMap = new Map<number, number>();
    for (const r of submitsLastHourRows) {
      if (r.userId != null) submitsLastHourMap.set(r.userId, r._count.userId);
    }

    const approvedByUser = new Map<number, number>();
    const rejectedByUser = new Map<number, number>();
    for (const a of attemptReviews) {
      if (a.status === 'APPROVED') {
        approvedByUser.set(a.userId, (approvedByUser.get(a.userId) ?? 0) + 1);
      } else {
        rejectedByUser.set(a.userId, (rejectedByUser.get(a.userId) ?? 0) + 1);
      }
    }

    const timeSumsByUser = new Map<number, { sum: number; count: number }>();
    for (const e of submitTimes) {
      if (e.userId == null) continue;
      const meta = (e.metadata as { time_to_submit_ms?: number }) ?? {};
      const ms = meta.time_to_submit_ms;
      if (typeof ms !== 'number' || !Number.isFinite(ms)) continue;
      const cur = timeSumsByUser.get(e.userId) ?? { sum: 0, count: 0 };
      cur.sum += ms;
      cur.count += 1;
      timeSumsByUser.set(e.userId, cur);
    }

    const userIds = new Set<number>([
      ...submitsLastHourMap.keys(),
      ...approvedByUser.keys(),
      ...rejectedByUser.keys(),
      ...timeSumsByUser.keys(),
    ]);

    const idList = Array.from(userIds);
    const users: { id: number; email: string | null }[] = [];
    for (const ids of chunk(idList, IN_CLAUSE_CHUNK_SIZE)) {
      const part = await this.prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, email: true },
      });
      users.push(...part);
    }
    const emailByUserId = new Map(users.map((u) => [u.id, u.email ?? '']));

    const rows: {
      userId: number;
      email: string;
      riskScore: number;
      submitsLastHour: number;
      rejectRate: number;
      avgTimeToSubmitMs: number | null;
    }[] = [];

    for (const userId of userIds) {
      const submitsLastHour = submitsLastHourMap.get(userId) ?? 0;
      const approved = approvedByUser.get(userId) ?? 0;
      const rejected = rejectedByUser.get(userId) ?? 0;
      const totalReviewed = approved + rejected;
      const rejectRate = totalReviewed > 0 ? rejected / totalReviewed : 0;
      const timeData = timeSumsByUser.get(userId);
      const avgTimeToSubmitMs =
        timeData && timeData.count > 0 ? timeData.sum / timeData.count : null;
      const fastSubmit = avgTimeToSubmitMs != null && avgTimeToSubmitMs < 8000;
      const riskScore =
        (submitsLastHour > 10 ? 1 : 0) + (rejectRate > 0.4 ? 1 : 0) + (fastSubmit ? 1 : 0);

      rows.push({
        userId,
        email: emailByUserId.get(userId) ?? '',
        riskScore,
        submitsLastHour,
        rejectRate: Math.round(rejectRate * 100) / 100,
        avgTimeToSubmitMs: avgTimeToSubmitMs != null ? Math.round(avgTimeToSubmitMs) : null,
      });
    }

    rows.sort((a, b) => b.riskScore - a.riskScore);
    return { users: rows.slice(0, limit) };
  }

  async analyticsRecompute(
    adminUserId: number,
    body: { dateKey?: string; recomputeScores?: boolean; recomputePerformance?: boolean },
  ) {
    await this.assertAdminById(adminUserId);
    const dateKey = (body?.dateKey ?? '').trim() || new Date().toISOString().slice(0, 10);
    await this.dailyMetricsService.recomputeDailyMetrics(dateKey);
    if (body?.recomputeScores) await this.scoreService.recomputeUserScores();
    if (body?.recomputePerformance) await this.scoreService.recomputeMissionTypePerformance();
    return { success: true, dateKey, recomputeScores: !!body?.recomputeScores, recomputePerformance: !!body?.recomputePerformance };
  }

  async getUserScores(adminUserId: number, limit: number) {
    await this.assertAdminById(adminUserId);
    const orderRisk: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    const rows = await this.prisma.userScore.findMany({
      take: 500,
      include: { user: { select: { id: true, email: true } } },
    });
    const sorted = [...rows].sort((a, b) => {
      const rA = orderRisk[a.riskLevel] ?? 2;
      const rB = orderRisk[b.riskLevel] ?? 2;
      if (rB !== rA) return rB - rA;
      return a.trustScore - b.trustScore;
    }).slice(0, Math.min(100, Math.max(1, limit)));
    return {
      userScores: sorted.map((s) => ({
        userId: s.userId,
        email: s.user?.email ?? '',
        trustScore: s.trustScore,
        riskLevel: s.riskLevel,
        rejects7d: s.rejects7d,
        submits1h: s.submits1h,
        avgTimeToSubmitMs: s.avgTimeToSubmitMs,
        updatedAt: s.updatedAt,
      })),
    };
  }

  async getMissionPerformance(adminUserId: number) {
    await this.assertAdminById(adminUserId);
    const rows = await this.prisma.missionTypePerformance.findMany({
      orderBy: { completionRate7d: 'desc' },
    });
    return { missionPerformance: rows };
  }

  // ---------------------------
  // Admin alerts (pilote)
  // ---------------------------
  async listAlerts(
    adminUserId: number,
    opts: { status?: string; page?: number; limit?: number } = {},
  ) {
    await this.assertAdminById(adminUserId);
    const status = (opts.status ?? 'OPEN').trim() || undefined;
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
    const skip = (page - 1) * limit;

    const [alerts, total] = await Promise.all([
      this.prisma.adminAlert.findMany({
        where: status ? { status } : undefined,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { user: { select: { id: true, email: true, name: true } } },
      }),
      this.prisma.adminAlert.count({ where: status ? { status } : undefined }),
    ]);

    return {
      alerts: alerts.map((a) => ({
        id: a.id,
        type: a.type,
        severity: a.severity,
        message: a.message,
        userId: a.userId,
        user: a.user,
        metadataJson: a.metadataJson,
        status: a.status,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      })),
      total,
      page,
      limit,
    };
  }

  async ackAlert(adminUserId: number, alertId: number) {
    await this.assertAdminById(adminUserId);
    const alert = await this.prisma.adminAlert.findUnique({ where: { id: alertId } });
    if (!alert) throw new NotFoundException('Alerte introuvable');
    await this.prisma.adminAlert.update({
      where: { id: alertId },
      data: { status: 'ACKED', updatedAt: new Date() },
    });
    return { success: true, status: 'ACKED' };
  }

  async resolveAlert(adminUserId: number, alertId: number) {
    await this.assertAdminById(adminUserId);
    const alert = await this.prisma.adminAlert.findUnique({ where: { id: alertId } });
    if (!alert) throw new NotFoundException('Alerte introuvable');
    await this.prisma.adminAlert.update({
      where: { id: alertId },
      data: { status: 'RESOLVED', updatedAt: new Date() },
    });
    return { success: true, status: 'RESOLVED' };
  }

  async updateUserCap(adminUserId: number, userId: number, dailyCapCents: number) {
    await this.assertAdminById(adminUserId);
    if (!Number.isFinite(userId) || userId <= 0) throw new BadRequestException('userId invalide');
    const cents = Math.max(0, Math.floor(Number(dailyCapCents)));
    await this.prisma.user.update({
      where: { id: userId },
      data: { dailyCapCents: cents },
    });
    return { success: true, dailyCapCents: cents };
  }

  async updateUserStatus(adminUserId: number, userId: number, isBlocked: boolean) {
    await this.assertAdminById(adminUserId);
    if (!Number.isFinite(userId) || userId <= 0) throw new BadRequestException('userId invalide');
    await this.prisma.user.update({
      where: { id: userId },
      data: { isBlocked: !!isBlocked },
    });
    return { success: true, isBlocked: !!isBlocked };
  }

  async updateUserRisk(
    adminUserId: number,
    userId: number,
    payload: { riskLevel?: string; trustScore?: number },
  ) {
    await this.assertAdminById(adminUserId);
    if (!Number.isFinite(userId) || userId <= 0) throw new BadRequestException('userId invalide');
    const data: { riskLevel?: string; trustScore?: number; updatedAt: Date } = { updatedAt: new Date() };
    if (payload.riskLevel !== undefined) {
      const level = String(payload.riskLevel).toUpperCase();
      if (!['LOW', 'MEDIUM', 'HIGH'].includes(level)) throw new BadRequestException('riskLevel must be LOW, MEDIUM or HIGH');
      data.riskLevel = level;
    }
    if (payload.trustScore !== undefined) {
      const score = Math.max(0, Math.min(100, Math.floor(Number(payload.trustScore))));
      data.trustScore = score;
    }
    if (Object.keys(data).length <= 1) throw new BadRequestException('Provide at least riskLevel or trustScore');
    const existing = await this.prisma.userScore.findUnique({ where: { userId } });
    await this.prisma.userScore.upsert({
      where: { userId },
      create: {
        userId,
        trustScore: data.trustScore ?? existing?.trustScore ?? 50,
        riskLevel: data.riskLevel ?? existing?.riskLevel ?? 'MEDIUM',
        rejects7d: existing?.rejects7d ?? 0,
        submits1h: existing?.submits1h ?? 0,
        avgTimeToSubmitMs: existing?.avgTimeToSubmitMs ?? 0,
        updatedAt: new Date(),
      },
      update: data,
    });
    return { success: true, ...data };
  }

  async banUser(adminUserId: number, userId: number, isBanned: boolean, reason?: string) {
    await this.assertAdminById(adminUserId);
    if (!Number.isFinite(userId) || userId <= 0) throw new BadRequestException('userId invalide');
    const now = new Date();
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        isBanned: !!isBanned,
        bannedReason: reason ?? null,
        bannedAt: isBanned ? now : null,
      },
    });
    await this.securityEvents.log('BANNED_ACTION', {
      userId,
      meta: { adminUserId, isBanned, reason: reason ?? null },
    });
    return { success: true, isBanned: !!isBanned, reason: reason ?? null };
  }

  async verifyUserEmail(adminUserId: number, userId: number, emailVerified: boolean) {
    await this.assertAdminById(adminUserId);
    if (!Number.isFinite(userId) || userId <= 0) throw new BadRequestException('userId invalide');
    await this.prisma.user.update({
      where: { id: userId },
      data: { emailVerified: !!emailVerified },
    });
    return { success: true, emailVerified: !!emailVerified };
  }

  async getSecurityEvents(
    adminUserId: number,
    type?: string,
    userId?: number,
    limit = 100,
  ) {
    await this.assertAdminById(adminUserId);
    const take = Math.min(200, Math.max(1, limit));
    const where: any = {};
    if (type) where.type = type;
    if (userId != null) where.userId = userId;
    const events = await this.prisma.securityEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      include: { user: { select: { id: true, email: true, name: true } } },
    });
    return { events };
  }

  // ---------------------------
  // Campaigns (mixed missions) — admin list
  // ---------------------------
  async listCampaigns(adminUserId: number, page?: number, limit = 50) {
    await this.assertAdminById(adminUserId);
    const skip = page != null && page > 0 ? (page - 1) * limit : 0;
    const [campaigns, total] = await Promise.all([
      this.prisma.campaign.findMany({
        skip,
        take: Math.min(limit, 100),
        orderBy: { createdAt: 'desc' },
        include: {
          brand: { select: { id: true, name: true } },
          _count: { select: { missions: true } },
        },
      }),
      this.prisma.campaign.count(),
    ]);
    return {
      items: campaigns.map((c) => ({
        id: c.id,
        name: c.name,
        brandId: c.brandId,
        brandName: c.brand.name,
        totalBudgetCents: c.totalBudgetCents,
        durationDays: c.durationDays,
        status: c.status,
        missionsCount: c._count.missions,
        createdAt: c.createdAt,
      })),
      total,
      page: page ?? 1,
      limit,
    };
  }

  // ---------------------------
  // Accounting (CentralPool = brand reserves + user liabilities)
  // ---------------------------
  async getAccountingSummary(adminUserId: number) {
    await this.assertAdminById(adminUserId);

    const [pool, brandSums, userSums] = await Promise.all([
      this.prisma.centralPool.findUnique({ where: { id: 1 } }),
      this.prisma.brandBudget.aggregate({
        _sum: {
          totalDepositedCents: true,
          reservedForMissionsCents: true,
          spentCents: true,
        },
      }),
      this.prisma.user.aggregate({
        _sum: {
          pendingCents: true,
          availableCents: true,
        },
      }),
    ]);

    const brandDeposited = Number(brandSums._sum.totalDepositedCents ?? 0);
    const brandReserved = Number(brandSums._sum.reservedForMissionsCents ?? 0);
    const brandSpent = Number(brandSums._sum.spentCents ?? 0);
    const userPendingTotal = Number(userSums._sum.pendingCents ?? 0);
    const userAvailableTotal = Number(userSums._sum.availableCents ?? 0);
    const recomputedReservedLiability = brandReserved + userPendingTotal + userAvailableTotal;

    const central = pool
      ? {
          id: pool.id,
          totalDepositedCents: pool.totalDepositedCents,
          reservedLiabilityCents: pool.reservedLiabilityCents,
          totalSpentCents: pool.totalSpentCents,
          platformRevenueCents: pool.platformRevenueCents,
          platformMarginCents: (pool as any).platformMarginCents ?? 0,
          platformAvailableCents: (pool as any).platformAvailableCents ?? 0,
          platformSpentCents: (pool as any).platformSpentCents ?? 0,
        }
      : null;

    const liabilityOk = central?.reservedLiabilityCents === recomputedReservedLiability;
    const depositedOk = central?.totalDepositedCents === brandDeposited;
    const spentOk = central?.totalSpentCents === brandSpent;
    const status = central && liabilityOk && depositedOk && spentOk ? 'OK' : 'MISMATCH';

    const diffs =
      status === 'MISMATCH' && central
        ? {
            reservedLiability: central.reservedLiabilityCents - recomputedReservedLiability,
            totalDeposited: central.totalDepositedCents - brandDeposited,
            totalSpent: central.totalSpentCents - brandSpent,
          }
        : null;

    return {
      centralPool: central,
      sums: {
        brandDeposited,
        brandReserved,
        brandSpent,
        userPendingTotal,
        userAvailableTotal,
      },
      recomputedReservedLiability,
      status,
      diffs,
    };
  }

  async reconcileAccounting(adminUserId: number) {
    await this.assertAdminById(adminUserId);

    const [brandSums, userSums] = await Promise.all([
      this.prisma.brandBudget.aggregate({
        _sum: {
          totalDepositedCents: true,
          reservedForMissionsCents: true,
          spentCents: true,
        },
      }),
      this.prisma.user.aggregate({
        _sum: {
          pendingCents: true,
          availableCents: true,
        },
      }),
    ]);

    const totalDeposited = Number(brandSums._sum.totalDepositedCents ?? 0);
    const totalSpent = Number(brandSums._sum.spentCents ?? 0);
    const reservedLiability =
      Number(brandSums._sum.reservedForMissionsCents ?? 0) +
      Number(userSums._sum.pendingCents ?? 0) +
      Number(userSums._sum.availableCents ?? 0);

    await this.prisma.centralPool.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        totalDepositedCents: totalDeposited,
        reservedLiabilityCents: reservedLiability,
        totalSpentCents: totalSpent,
        platformRevenueCents: 0,
        platformMarginCents: 0,
        platformAvailableCents: 0,
        platformSpentCents: 0,
      },
      update: {
        totalDepositedCents: totalDeposited,
        reservedLiabilityCents: reservedLiability,
        totalSpentCents: totalSpent,
      },
    });

    return {
      success: true,
      totalDepositedCents: totalDeposited,
      reservedLiabilityCents: reservedLiability,
      totalSpentCents: totalSpent,
    };
  }

  async createPlatformCampaign(
    adminUserId: number,
    payload: {
      platform: string;
      missionTypeCode: string;
      quantity: number;
      title: string;
      description: string;
      actionUrl: string;
    },
  ) {
    await this.assertAdminById(adminUserId);

    const platform = (payload.platform ?? '').trim().toUpperCase();
    const validPlatforms = ['INSTAGRAM', 'FACEBOOK', 'TIKTOK'];
    if (!validPlatforms.includes(platform)) {
      throw new BadRequestException('platform invalide (INSTAGRAM, FACEBOOK ou TIKTOK)');
    }

    const missionTypeCode = (payload.missionTypeCode ?? '').trim().toUpperCase();
    const platformTypes = ['FOLLOW_AQERA', 'REFERRAL', 'REVIEW', 'STORY_AQERA'];
    if (!platformTypes.includes(missionTypeCode)) {
      throw new BadRequestException('missionTypeCode invalide (FOLLOW_AQERA, REFERRAL, REVIEW, STORY_AQERA)');
    }

    const quantity = Math.max(0, Math.floor(Number(payload.quantity ?? 0)));
    if (!quantity) throw new BadRequestException('quantity obligatoire');

    const title = (payload.title ?? '').trim();
    const description = (payload.description ?? '').trim();
    const actionUrl = (payload.actionUrl ?? '').trim();
    if (!title) throw new BadRequestException('title obligatoire');
    if (!description) throw new BadRequestException('description obligatoire');
    if (!actionUrl) throw new BadRequestException('actionUrl obligatoire');
    if (!/^https?:\/\//i.test(actionUrl)) {
      throw new BadRequestException('actionUrl invalide (http/https)');
    }

    const aqeraBrand = await this.prisma.brand.findUnique({ where: { slug: 'aqera' } });
    if (!aqeraBrand) throw new NotFoundException('Marque AQERA introuvable (exécutez le seed)');

    const missionType = await this.prisma.missionType.findUnique({ where: { code: missionTypeCode } });
    if (!missionType || !missionType.isActive) throw new NotFoundException('MissionType invalide ou inactif');

    const totalRewardsCents = missionType.userRewardCents * quantity;

    const result = await this.prisma.$transaction(async (tx) => {
      const pool = await tx.centralPool.findUnique({ where: { id: 1 } });
      if (!pool) throw new BadRequestException('CentralPool introuvable');
      const available = Number((pool as any).platformAvailableCents ?? 0);
      if (available < totalRewardsCents) {
        throw new BadRequestException(
          `Budget AQERA insuffisant (disponible: ${(available / 100).toFixed(2)}$, besoin: ${(totalRewardsCents / 100).toFixed(2)}$)`,
        );
      }

      await tx.centralPool.update({
        where: { id: 1 },
        data: {
          platformAvailableCents: { decrement: totalRewardsCents },
          platformSpentCents: { increment: totalRewardsCents },
        },
      });

      const mission = await tx.mission.create({
        data: {
          brandId: aqeraBrand.id,
          missionTypeId: missionType.id,
          platform,
          title,
          description,
          actionUrl,
          quantityTotal: quantity,
          quantityRemaining: quantity,
          status: 'ACTIVE',
        },
        include: { missionType: true },
      });

      return { mission };
    });

    return {
      success: true,
      message: 'Campagne AQERA créée ✅',
      mission: result.mission,
    };
  }

  async listPlatformCampaigns(adminUserId: number) {
    await this.assertAdminById(adminUserId);

    const aqeraBrand = await this.prisma.brand.findUnique({ where: { slug: 'aqera' } });
    if (!aqeraBrand) return { campaigns: [] };

    const missions = await this.prisma.mission.findMany({
      where: { brandId: aqeraBrand.id },
      include: { missionType: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    return {
      campaigns: missions.map((m) => ({
        id: m.id,
        title: m.title,
        description: m.description,
        actionUrl: m.actionUrl,
        platform: m.platform,
        status: m.status,
        quantityTotal: m.quantityTotal,
        quantityRemaining: m.quantityRemaining,
        missionTypeCode: m.missionType?.code,
        missionTypeLabel: m.missionType?.label,
        createdAt: m.createdAt,
      })),
    };
  }

  // ----------------------- helpers -----------------------
  private assertId(value: any, label = 'id') {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) throw new BadRequestException(`${label} invalide`);
  }

  private normalizeEmail(email: string) {
    return (email ?? '').trim().toLowerCase();
  }

  private makeTempPassword(length = 10) {
    // simple + readable (avoid ambiguous chars)
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < length; i++) {
      out += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return out;
  }
}