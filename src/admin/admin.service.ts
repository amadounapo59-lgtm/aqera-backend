import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
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

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
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

      const reward = mission.missionType?.userRewardCents ?? 0;
      if (!Number.isFinite(reward) || reward <= 0) throw new BadRequestException('Reward invalide');

      // ✅ Safety: ensure reserved budget exists for this approval
      if (mission.brandId) {
        const budget = await tx.brandBudget.findUnique({ where: { brandId: mission.brandId } });
        if (!budget) throw new BadRequestException('Budget marque non configuré (admin)');
        if (Number(budget.reservedForMissionsCents) < Number(reward)) {
          throw new BadRequestException('Réserve insuffisante pour approuver (mission non réservée ?)');
        }
      }

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

      // 4) ✅ Brand budget accounting (marketing cost at approval)
      // Move reserved -> spent when the mission is APPROVED
      if (mission.brandId) {
        await tx.brandBudget.updateMany({
          where: { brandId: mission.brandId },
          data: {
            reservedForMissionsCents: { decrement: Number(reward) },
            spentCents: { increment: Number(reward) },
          },
        });
      }

      return {
        success: true,
        message: 'Attempt approuvé ✅',
        creditedCents: Number(reward),
        balanceCents: updatedUser.balanceCents,
      };
    });
  }

  // ---------------------------
  // ✅ Brand Budgets (ADMIN)
  // ---------------------------

  async topupBrandBudget(adminUserId: number, brandId: number, amountCents: number) {
    await this.assertAdminById(adminUserId);
    if (!Number.isFinite(brandId) || brandId <= 0) throw new BadRequestException('brandId invalide');
    if (!Number.isFinite(amountCents) || amountCents <= 0) throw new BadRequestException('amountCents invalide');

    return this.prisma.$transaction(async (tx) => {
      const brand = await tx.brand.findUnique({ where: { id: brandId } });
      if (!brand) throw new NotFoundException('Brand introuvable');

      const budget = await tx.brandBudget.upsert({
        where: { brandId },
        create: {
          brandId,
          totalDepositedCents: amountCents,
          reservedForMissionsCents: 0,
          spentCents: 0,
        },
        update: { totalDepositedCents: { increment: amountCents } },
      });

      await tx.centralPool.upsert({
        where: { id: 1 },
        create: { id: 1, totalDepositedCents: amountCents, reservedLiabilityCents: 0, totalSpentCents: 0 },
        update: { totalDepositedCents: { increment: amountCents } },
      });

      return { success: true, brandId, amountCents, totalDepositedCents: budget.totalDepositedCents };
    });
  }

  async getBrandBudget(adminUserId: number, brandId: number) {
    await this.assertAdminById(adminUserId);
    if (!Number.isFinite(brandId) || brandId <= 0) throw new BadRequestException('brandId invalide');
    const budget = await this.prisma.brandBudget.findUnique({ where: { brandId } });
    if (!budget) throw new NotFoundException('Budget marque introuvable');
    const availableCents =
      Number(budget.totalDepositedCents) - Number(budget.reservedForMissionsCents) - Number(budget.spentCents);
    return { ...budget, availableCents };
  }

  async rejectAttempt(adminUserId: number, attemptId: number) {
    const admin = await this.assertAdminById(adminUserId);

    if (!Number.isFinite(attemptId) || attemptId <= 0) {
      throw new BadRequestException('attemptId invalide');
    }

    const attempt = await this.prisma.missionAttempt.findUnique({ where: { id: attemptId } });
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

      const reward = full.mission?.missionType?.userRewardCents ?? 0;

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
            type: 'PENDING_RELEASE',
            amountCents: Number(reward),
            note: `Mission rejected: ${full.mission.title}`,
            missionId: full.missionId,
            attemptId: full.id,
          },
        });

        await tx.brandBudget.updateMany({
          where: { brandId: full.mission.brandId },
          data: { reservedForMissionsCents: { decrement: reward } },
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
          description: app.category ?? null,
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