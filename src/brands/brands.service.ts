import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

type AuthUser = { id: number; role?: string; brandId?: number | null; agencyId?: number | null };

@Injectable()
export class BrandsService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeEmail(email: string) {
    return (email ?? '').trim().toLowerCase();
  }

  private cleanText(v?: any, max = 5000): string | undefined {
    if (v === undefined || v === null) return undefined;
    const s = String(v).trim();
    if (!s) return undefined;
    return s.length > max ? s.slice(0, max) : s;
  }

  private cleanUrl(v?: any): string | undefined {
    const s = this.cleanText(v, 2048);
    if (!s) return undefined;
    // Accept http/https only (prevents "javascript:" etc.)
    if (!/^https?:\/\//i.test(s)) {
      throw new BadRequestException('URL invalide (http/https requis)');
    }
    return s;
  }

  /**
   * En v1, on demande aux marques de coller un lien social (Instagram / TikTok / Facebook)
   * qui sera ensuite affiché côté user dans la mission.
   */
  private assertSocialUrl(url: string) {
    const cleaned = (url ?? '').trim();
    if (!cleaned) throw new BadRequestException('Lien social obligatoire');

    let host = '';
    try {
      const u = new URL(cleaned);
      if (!['http:', 'https:'].includes(u.protocol)) {
        throw new BadRequestException('Lien social invalide (http/https requis)');
      }
      host = (u.hostname || '').toLowerCase();
    } catch {
      throw new BadRequestException('Lien social invalide');
    }

    const ok =
      host === 'instagram.com' ||
      host.endsWith('.instagram.com') ||
      host === 'tiktok.com' ||
      host.endsWith('.tiktok.com') ||
      host === 'facebook.com' ||
      host.endsWith('.facebook.com') ||
      host === 'fb.com' ||
      host.endsWith('.fb.com');

    if (!ok) {
      throw new BadRequestException('Lien social invalide (Instagram / TikTok / Facebook uniquement)');
    }
  }

  async createBrandApplication(body: any) {
    const email = this.normalizeEmail(body?.email ?? body?.contactEmail);
    const businessName = this.cleanText(body?.businessName ?? body?.brandName, 200);
    if (!email) throw new BadRequestException('Email obligatoire');
    if (!businessName) throw new BadRequestException('Nom de la marque obligatoire');

    const phone = this.cleanText(body?.phone, 50);
    const address = this.cleanText(body?.address, 200);
    const city = this.cleanText(body?.city, 120);
    const website = body?.website ? this.cleanUrl(body.website) : undefined;
    const instagram = this.cleanText(body?.instagram, 120);
    const category = this.cleanText(body?.category, 80) ?? 'Restaurant';
    const notes = this.cleanText(body?.description, 2000);

    await this.prisma.brandApplication.create({
      data: {
        email,
        businessName,
        phone,
        address,
        city,
        website,
        instagram,
        category,
        notes,
      },
    });

    return { success: true, message: 'Demande envoyée ✅' };
  }

  // -----------------------------
  // PUBLIC: Brand application
  // -----------------------------
  async apply(payload: any) {
    const email = this.normalizeEmail(payload?.contactEmail ?? payload?.email);
    const brandName = (payload?.brandName ?? payload?.businessName ?? '').trim();
    if (!email) throw new BadRequestException('Email obligatoire');
    if (!brandName) throw new BadRequestException('Nom de la marque obligatoire');

    const created = await this.prisma.brandApplication.create({
      data: {
        email,
        businessName: brandName,
        phone: payload?.phone ? String(payload.phone).trim() : undefined,
        address: payload?.address ? String(payload.address).trim() : undefined,
        city: payload?.city ? String(payload.city).trim() : undefined,
        province: payload?.province ? String(payload.province).trim() : undefined,
        country: payload?.country ? String(payload.country).trim() : undefined,
        website: payload?.website ? String(payload.website).trim() : undefined,
        instagram: payload?.instagram ? String(payload.instagram).trim() : undefined,
        category: payload?.category ? String(payload.category).trim() : undefined,
        status: 'PENDING',
      },
      select: { id: true },
    });

    return {
      success: true,
      message: 'Demande envoyée ✅. Un admin va valider et activer ton compte Marque.',
      requestId: created.id,
    };
  }

  // -----------------------------
  // Helpers: resolve brand access
  // -----------------------------
  private async resolveBrandId(user: AuthUser, brandId?: number) {
    const role = (user?.role ?? 'USER').toUpperCase();

    if (role === 'BRAND') {
      if (!user.brandId) throw new ForbiddenException('Compte marque non lié à une marque');
      return user.brandId;
    }

    if (role === 'AGENCY') {
      if (!user.agencyId) throw new ForbiddenException('Compte agence non lié à une agence');
      if (!brandId) throw new BadRequestException('brandId requis pour une agence');

      const link = await this.prisma.agencyBrand.findUnique({
        // @@unique([agencyId, brandId], name: "uniq_agency_brand")
        where: { uniq_agency_brand: { agencyId: user.agencyId, brandId } },
        select: { id: true },
      });
      if (!link) throw new ForbiddenException("Cette marque n'est pas gérée par ton agence");
      return brandId;
    }

    throw new ForbiddenException('Accès interdit');
  }

  async getBrandContext(user: AuthUser, brandId?: number) {
    const bid = await this.resolveBrandId(user, brandId);
    const brand = await this.prisma.brand.findUnique({
      where: { id: bid },
      include: { budget: true },
    });
    if (!brand) throw new NotFoundException('Marque introuvable');

    return {
      brand: {
        id: brand.id,
        name: brand.name,
        slug: brand.slug,
        description: brand.description,
        logoUrl: brand.logoUrl,
        website: brand.website,
        coverUrl: brand.coverUrl,
        subscriptionStatus: brand.subscriptionStatus,
        trialEndsAt: brand.trialEndsAt,
        plan: brand.plan,
      },
          budget: brand.budget
            ? (() => {
                const total = Number(brand.budget.totalDepositedCents);
                const reserved = Number(brand.budget.reservedForMissionsCents);
                const spent = Number(brand.budget.spentCents);
                const available = Math.max(0, total - reserved - spent);
                return {
                  totalBudgetCents: total,
                  lockedCents: reserved,
                  availableCents: available,
                  pendingRewardsCents: reserved,
                };
              })()
            : null,
    };
  }

  // Backwards compatibility: controller uses getBrandMe()
  async getBrandMe(user: AuthUser, brandId?: number) {
    return this.getBrandContext(user, brandId);
  }

  // Update brand profile fields (settings)
  async updateBrandMe(user: AuthUser, payload: any, brandId?: number) {
    const resolvedBrandId = await this.resolveBrandId(user, brandId);
    const updates: Prisma.BrandUpdateInput = {
      description: this.cleanText(payload?.description, 2000),
      website: this.cleanUrl(payload?.website),
      logoUrl: this.cleanUrl(payload?.logoUrl),
      coverUrl: this.cleanUrl(payload?.coverUrl),
    };

    // remove undefined keys so Prisma doesn't complain
    Object.keys(updates).forEach((k) => (updates as any)[k] === undefined && delete (updates as any)[k]);

    const updated = await this.prisma.brand.update({
      where: { id: resolvedBrandId },
      data: updates,
    });

    return { success: true, brand: updated };
  }

  // -----------------------------
  // BRAND/AGENCY: Missions CRUD
  // -----------------------------
  async listMissions(user: AuthUser, brandId?: number) {
    const bid = await this.resolveBrandId(user, brandId);
    const missions = await this.prisma.mission.findMany({
      where: { brandId: bid },
      include: { missionType: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    return {
      missions: missions.map((m) => ({
        id: m.id,
        title: m.title,
        description: m.description,
        actionUrl: m.actionUrl,
        status: m.status,
        quantityTotal: m.quantityTotal,
        quantityRemaining: m.quantityRemaining,
        createdAt: m.createdAt,
        missionType: m.missionType
          ? {
              id: m.missionType.id,
              code: m.missionType.code,
              label: m.missionType.label,
              userRewardCents: m.missionType.userRewardCents,
              brandCostCents: m.missionType.brandCostCents,
            }
          : null,
      })),
    };
  }

  async createMission(
    user: AuthUser,
    data: {
      brandId?: number;
      missionTypeId?: number;
      missionTypeCode?: string;
      title: string;
      description: string;
      actionUrl: string;
      quantityTotal: number;
    },
  ) {
    const bid = await this.resolveBrandId(user, data.brandId);
    // Accept either missionTypeId or missionTypeCode (web dashboard uses code).
    let mtId = Number(data.missionTypeId ?? 0);
    let mt = Number.isFinite(mtId) && mtId > 0
      ? await this.prisma.missionType.findUnique({ where: { id: mtId } })
      : null;

    if (!mt) {
      const code = (data.missionTypeCode ?? '').trim().toUpperCase();
      if (!code) throw new BadRequestException('missionTypeId ou missionTypeCode obligatoire');
      mt = await this.prisma.missionType.findUnique({ where: { code } });
      if (!mt) throw new BadRequestException('MissionType invalide');
      mtId = mt.id;
    }

    if (!mt.isActive) throw new BadRequestException('MissionType inactif');
    const qty = Math.max(0, Math.floor(Number(data.quantityTotal ?? 0)));
    if (!qty) throw new BadRequestException('quantityTotal obligatoire');
    const title = (data.title ?? '').trim();
    const description = (data.description ?? '').trim();
    const actionUrl = (data.actionUrl ?? '').trim();
    if (!title) throw new BadRequestException('Titre obligatoire');
    if (!description) throw new BadRequestException('Description obligatoire');
    if (!actionUrl) throw new BadRequestException('Lien social obligatoire');
    // We keep it simple: a public link that users can open on mobile.
    // Accepts https://... (recommended) or http://... for dev.
    if (!/^https?:\/\//i.test(actionUrl)) {
      throw new BadRequestException('Lien invalide (doit commencer par http:// ou https://)');
    }
    // Commercial requirement: link must be a social profile/page (IG/TikTok/FB)
    this.assertSocialUrl(actionUrl);

    // mt already loaded above

    // Optional: check brand budget coverage for the mission's maximum exposure
    // (qty * brandCostCents). If no budget exists yet, allow creation but keep PENDING_APPROVAL.
    const budget = await this.prisma.brandBudget.findUnique({ where: { brandId: bid } });
    if (budget) {
      const needed = qty * mt.brandCostCents;
      const available =
        Number(budget.totalDepositedCents) -
        Number(budget.reservedForMissionsCents) -
        Number(budget.spentCents);
      if (needed > available) {
        throw new BadRequestException(
          `Budget insuffisant pour ${qty} missions (besoin ${(needed / 100).toFixed(2)}$). Recharge le budget ou baisse la quantité.`,
        );
      }
    }

    const mission = await this.prisma.mission.create({
      data: {
        brandId: bid,
        missionTypeId: mtId,
        title,
        description,
        actionUrl,
        quantityTotal: qty,
        quantityRemaining: qty,
        status: 'PENDING_APPROVAL',
      },
      include: { missionType: true },
    });

    return { success: true, mission };
  }

  async updateMission(
    user: AuthUser,
    missionId: number,
    data: Partial<{ title: string; description: string; actionUrl: string; quantityTotal: number }>,
    brandId?: number,
  ) {
    const bid = await this.resolveBrandId(user, brandId);
    const id = Number(missionId);
    if (!Number.isFinite(id) || id <= 0) throw new BadRequestException('missionId invalide');

    const mission = await this.prisma.mission.findUnique({ where: { id } });
    if (!mission || mission.brandId !== bid) throw new NotFoundException('Mission introuvable');

    const patch: Prisma.MissionUpdateInput = {};
    if (typeof data.title === 'string') patch.title = data.title.trim();
    if (typeof data.description === 'string') patch.description = data.description.trim();
    if (typeof data.actionUrl === 'string') {
      const u = data.actionUrl.trim();
      if (!u) throw new BadRequestException('Lien social obligatoire');
      if (!/^https?:\/\//i.test(u)) {
        throw new BadRequestException('Lien invalide (doit commencer par http:// ou https://)');
      }
      this.assertSocialUrl(u);
      patch.actionUrl = u;
    }

    if (data.quantityTotal !== undefined) {
      const qty = Math.max(0, Math.floor(Number(data.quantityTotal)));
      if (!qty) throw new BadRequestException('quantityTotal invalide');
      // Keep remaining aligned when increasing/decreasing.
      const delta = qty - mission.quantityTotal;
      patch.quantityTotal = qty;
      patch.quantityRemaining = Math.max(0, mission.quantityRemaining + delta);
    }

    const updated = await this.prisma.mission.update({
      where: { id },
      data: patch,
      include: { missionType: true },
    });
    return { success: true, mission: updated };
  }

  async setMissionStatus(user: AuthUser, missionId: number, status: 'ACTIVE' | 'PAUSED', brandId?: number) {
    const bid = await this.resolveBrandId(user, brandId);
    const id = Number(missionId);
    if (!Number.isFinite(id) || id <= 0) throw new BadRequestException('missionId invalide');
    const mission = await this.prisma.mission.findUnique({ where: { id } });
    if (!mission || mission.brandId !== bid) throw new NotFoundException('Mission introuvable');

    const updated = await this.prisma.mission.update({ where: { id }, data: { status } });
    return { success: true, mission: updated };
  }

  // -----------------------------
  // BRAND/AGENCY: Stats
  // -----------------------------
  async getStats(user: AuthUser, brandId?: number) {
    const bid = await this.resolveBrandId(user, brandId);

    // Seller-ready window (simple)
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [missionCounts, attemptCounts, budget, activeMissions, engagedUsers] = await Promise.all([
      this.prisma.mission.groupBy({
        by: ['status'],
        where: { brandId: bid },
        _count: { _all: true },
      }),
      this.prisma.missionAttempt.groupBy({
        by: ['status'],
        where: { mission: { brandId: bid } },
        _count: { _all: true },
      }),
      this.prisma.brandBudget.findUnique({ where: { brandId: bid } }),
      this.prisma.mission.count({
        where: { brandId: bid, status: 'ACTIVE', quantityRemaining: { gt: 0 } },
      }),
      this.prisma.missionAttempt.findMany({
        where: {
          mission: { brandId: bid },
          createdAt: { gte: since30d },
          status: { in: ['PENDING', 'APPROVED'] },
        },
        select: { userId: true },
        distinct: ['userId'],
      }),
    ]);

    const missionsByStatus: Record<string, number> = {};
    for (const row of missionCounts) missionsByStatus[row.status] = row._count._all;

    const attemptsByStatus: Record<string, number> = {};
    for (const row of attemptCounts) attemptsByStatus[row.status] = row._count._all;

    const budgetSafe = budget
      ? {
          totalBudgetCents: Number(budget.totalDepositedCents),
          lockedCents: Number(budget.reservedForMissionsCents),
          availableCents:
            Number(budget.totalDepositedCents) -
            Number(budget.reservedForMissionsCents) -
            Number(budget.spentCents),
          pendingRewardsCents: Number(budget.reservedForMissionsCents),
        }
      : null;

    const lowBudgetThresholdCents = 5000; // $50 (simple)
    const lowBudget = (budgetSafe?.availableCents ?? 0) > 0 && (budgetSafe?.availableCents ?? 0) <= lowBudgetThresholdCents;

    return {
      missionsByStatus,
      attemptsByStatus,
      activeMissions,
      engagedUsers30d: engagedUsers.length,
      lowBudget,
      lowBudgetThresholdCents,
      budget: budgetSafe,
    };
  }
}
