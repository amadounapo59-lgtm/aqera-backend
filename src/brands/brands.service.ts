import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { EventNames, EntityTypes } from '../analytics/events';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/** Dénominations autorisées pour les cartes cadeaux (10$, 20$, 50$) */
const TOPUP_ALLOWED_DENOMINATIONS_CENTS = [1000, 2000, 5000];

/** Catégories marque (MVP) – required for discovery */
export const BRAND_CATEGORIES = [
  'RESTAURANT', 'CAFE', 'BARBER', 'BOUTIQUE', 'BEAUTE', 'VOYAGE', 'SANTE', 'DIVERTISSEMENT', 'SERVICES', 'MODE',
] as const;
export type BrandCategory = (typeof BRAND_CATEGORIES)[number];

const CATEGORY_LABELS: Record<string, string> = {
  RESTAURANT: 'Restaurants',
  CAFE: 'Cafés',
  BARBER: 'Barbiers',
  BOUTIQUE: 'Boutiques',
  BEAUTE: 'Beauté',
  VOYAGE: 'Voyage',
  SANTE: 'Santé',
  DIVERTISSEMENT: 'Divertissement',
  SERVICES: 'Services',
  MODE: 'Mode',
};

function normalizeCategory(v: string | undefined | null): BrandCategory {
  const u = (v ?? '').trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (BRAND_CATEGORIES.includes(u as BrandCategory)) return u as BrandCategory;
  if (u === 'RESTAURANTS' || u.startsWith('RESTAURANT')) return 'RESTAURANT';
  if (u === 'CAFE' || u === 'CAFES') return 'CAFE';
  if (u === 'BARBER' || u === 'BARBIERS') return 'BARBER';
  if (u === 'BOUTIQUE' || u === 'BOUTIQUES') return 'BOUTIQUE';
  if (u === 'BEAUTE' || u === 'BEAUTÉ') return 'BEAUTE';
  if (u === 'VOYAGE' || u === 'VOYAGES') return 'VOYAGE';
  if (u === 'SANTE' || u === 'SANTÉ') return 'SANTE';
  if (u === 'DIVERTISSEMENT') return 'DIVERTISSEMENT';
  if (u === 'SERVICES') return 'SERVICES';
  if (u === 'MODE') return 'MODE';
  return 'RESTAURANT';
}

type AuthUser = { id: number; role?: string; brandId?: number | null; agencyId?: number | null };

const ALLOWED_LOGO_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

@Injectable()
export class BrandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  private normalizeEmail(email: string) {
    return (email ?? '').trim().toLowerCase();
  }

  private cleanText(v?: any, max = 5000): string | undefined {
    if (v === undefined || v === null) return undefined;
    const s = String(v).trim();
    if (!s) return undefined;
    return s.length > max ? s.slice(0, max) : s;
  }

  /**
   * Valide une URL : accepte http(s) ou un chemin relatif commençant par /
   * (pour logoUrl/coverUrl renvoyés après upload : /uploads/logos/...).
   */
  private cleanUrl(v?: any): string | undefined {
    const s = this.cleanText(v, 2048);
    if (!s) return undefined;
    // Chemin relatif (ex. /uploads/logos/xxx) : accepté pour logo/cover
    if (s.startsWith('/')) return s;
    // URL absolue : http/https uniquement (évite javascript:, etc.)
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
    const initialBudgetCents = body?.initialBudgetCents != null
      ? Math.max(0, Math.floor(Number(body.initialBudgetCents)))
      : undefined;

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
        initialBudgetCents: initialBudgetCents ?? undefined,
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

    const address = (payload?.address ?? '').trim();
    if (!address) throw new BadRequestException('Adresse obligatoire');

    const categoryRaw = (payload?.category ?? '').trim();
    if (!categoryRaw) throw new BadRequestException('Catégorie obligatoire');

    const created = await this.prisma.brandApplication.create({
      data: {
        email,
        businessName: brandName,
        phone: payload?.phone ? String(payload.phone).trim() : undefined,
        address,
        city: payload?.city ? String(payload.city).trim() : undefined,
        province: payload?.province ? String(payload.province).trim() : undefined,
        country: payload?.country ? String(payload.country).trim() : undefined,
        website: payload?.website ? String(payload.website).trim() : undefined,
        instagram: payload?.instagram ? String(payload.instagram).trim() : undefined,
        category: normalizeCategory(categoryRaw),
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

  /**
   * GET /brands/popular – Top brands by activity score (public).
   * score = activeMissions * 3 + completedActions + availableGiftCards * 2
   */
  async getPopularBrands(limit = 10): Promise<
    { id: number; name: string; logoUrl: string | null; city: string | null; activeMissionsCount: number; availableGiftCardsCount: number }[]
  > {
    const brands = await this.prisma.brand.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, logoUrl: true },
    });

    const brandIds = brands.map((b) => b.id);
    if (brandIds.length === 0) return [];

    const [activeMissions, approvedAttempts, giftCardsWithStock] = await Promise.all([
      this.prisma.mission.groupBy({
        by: ['brandId'],
        where: { brandId: { in: brandIds }, status: 'ACTIVE', quantityRemaining: { gt: 0 } },
        _count: { id: true },
      }),
      this.prisma.missionAttempt.findMany({
        where: { status: 'APPROVED', mission: { brandId: { in: brandIds } } },
        select: { mission: { select: { brandId: true } } },
      }),
      this.prisma.giftCard.findMany({
        where: { brandId: { in: brandIds }, inventory: { some: { status: 'AVAILABLE' } } },
        select: { brandId: true },
      }),
    ]);

    const activeByBrand = new Map<number, number>();
    activeMissions.forEach((r) => activeByBrand.set(r.brandId, r._count.id));

    const completedByBrand = new Map<number, number>();
    approvedAttempts.forEach((a) => {
      const bid = (a.mission as { brandId: number }).brandId;
      completedByBrand.set(bid, (completedByBrand.get(bid) ?? 0) + 1);
    });

    const giftCardsByBrand = new Map<number, number>();
    giftCardsWithStock.forEach((g) => {
      giftCardsByBrand.set(g.brandId, (giftCardsByBrand.get(g.brandId) ?? 0) + 1);
    });

    const scored = brands.map((b) => {
      const activeMissionsCount = activeByBrand.get(b.id) ?? 0;
      const completedActions = completedByBrand.get(b.id) ?? 0;
      const availableGiftCardsCount = giftCardsByBrand.get(b.id) ?? 0;
      const score = activeMissionsCount * 3 + completedActions + availableGiftCardsCount * 2;
      return {
        ...b,
        city: null as string | null,
        activeMissionsCount,
        availableGiftCardsCount,
        score,
      };
    });

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, limit);

    return top.map(({ score: _s, ...rest }) => ({
      id: rest.id,
      name: rest.name,
      logoUrl: rest.logoUrl,
      city: rest.city,
      activeMissionsCount: rest.activeMissionsCount,
      availableGiftCardsCount: rest.availableGiftCardsCount,
    }));
  }

  /** GET /brands/:id – Public brand info for detail page */
  async getBrandPublic(brandId: number) {
    const brand = await this.prisma.brand.findFirst({
      where: { id: brandId, status: 'ACTIVE' },
      select: { id: true, name: true, slug: true, logoUrl: true, coverUrl: true, description: true, category: true },
    });
    if (!brand) throw new NotFoundException('Marque introuvable');
    return brand;
  }

  /**
   * GET /brands/by-category – Discovery: categories with brands, ranked by activity.
   * Only categories that have at least 1 ACTIVE brand. Brands ranked by score.
   */
  async getBrandsByCategory(): Promise<
    { category: string; label: string; brands: { id: number; name: string; logoUrl: string | null; city: string | null; activeMissionsCount: number; availableGiftCardsCount: number }[] }[]
  > {
    const brands = await this.prisma.brand.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, logoUrl: true, category: true },
    });

    const brandIds = brands.map((b) => b.id);
    if (brandIds.length === 0) return [];

    const [activeMissions, approvedAttempts, giftCardsWithStock] = await Promise.all([
      this.prisma.mission.groupBy({
        by: ['brandId'],
        where: { brandId: { in: brandIds }, status: 'ACTIVE', quantityRemaining: { gt: 0 } },
        _count: { id: true },
      }),
      this.prisma.missionAttempt.findMany({
        where: { status: 'APPROVED', mission: { brandId: { in: brandIds } } },
        select: { mission: { select: { brandId: true } } },
      }),
      this.prisma.giftCard.findMany({
        where: { brandId: { in: brandIds }, inventory: { some: { status: 'AVAILABLE' } } },
        select: { brandId: true },
      }),
    ]);

    const activeByBrand = new Map<number, number>();
    activeMissions.forEach((r) => activeByBrand.set(r.brandId, r._count.id));
    const completedByBrand = new Map<number, number>();
    approvedAttempts.forEach((a) => {
      const bid = (a.mission as { brandId: number }).brandId;
      completedByBrand.set(bid, (completedByBrand.get(bid) ?? 0) + 1);
    });
    const giftCardsByBrand = new Map<number, number>();
    giftCardsWithStock.forEach((g) => {
      giftCardsByBrand.set(g.brandId, (giftCardsByBrand.get(g.brandId) ?? 0) + 1);
    });

    const byCategory = new Map<string, typeof brands>();
    for (const b of brands) {
      const cat = normalizeCategory(b.category ?? 'RESTAURANT');
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(b);
    }

    const result: { category: string; label: string; brands: any[] }[] = [];
    for (const [category, catBrands] of byCategory.entries()) {
      const scored = catBrands.map((b) => {
        const activeMissionsCount = activeByBrand.get(b.id) ?? 0;
        const completedActions = completedByBrand.get(b.id) ?? 0;
        const availableGiftCardsCount = giftCardsByBrand.get(b.id) ?? 0;
        const score = activeMissionsCount * 3 + completedActions + availableGiftCardsCount * 2;
        return {
          ...b,
          activeMissionsCount,
          availableGiftCardsCount,
          score,
        };
      });
      scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.activeMissionsCount !== a.activeMissionsCount) return b.activeMissionsCount - a.activeMissionsCount;
        return b.availableGiftCardsCount - a.availableGiftCardsCount;
      });
      result.push({
        category,
        label: CATEGORY_LABELS[category] ?? category,
        brands: scored.map(({ score: _s, category: _c, ...rest }) => ({
          id: rest.id,
          name: rest.name,
          logoUrl: rest.logoUrl,
          city: null as string | null,
          activeMissionsCount: rest.activeMissionsCount,
          availableGiftCardsCount: rest.availableGiftCardsCount,
        })),
      });
    }
    result.sort((a, b) => (CATEGORY_LABELS[a.category] ?? a.category).localeCompare(CATEGORY_LABELS[b.category] ?? b.category));
    return result;
  }

  // -----------------------------
  // Helpers: resolve brand access
  // -----------------------------
  private async resolveBrandId(user: AuthUser, brandId?: number) {
    const role = (user?.role ?? 'USER').toUpperCase();

    if (role === 'BRAND' || role === 'BRAND_OWNER' || role === 'BRAND_STAFF') {
      if (!user.brandId) throw new ForbiddenException('Compte marque non lié à une marque');
      const brand = await this.prisma.brand.findUnique({
        where: { id: user.brandId },
        select: { status: true },
      });
      if (!brand || brand.status !== 'ACTIVE') {
        throw new ForbiddenException('Compte marque suspendu ou supprimé.');
      }
      return user.brandId;
    }

    if (role === 'AGENCY') {
      if (!user.agencyId) throw new ForbiddenException('Compte agence non lié à une agence');
      if (!brandId) throw new BadRequestException('brandId requis pour une agence');

      const link = await this.prisma.agencyBrand.findUnique({
        where: { uniq_agency_brand: { agencyId: user.agencyId, brandId } },
        select: { id: true },
      });
      if (!link) throw new ForbiddenException("Cette marque n'est pas gérée par ton agence");
      const brand = await this.prisma.brand.findUnique({
        where: { id: brandId },
        select: { status: true },
      });
      if (!brand || brand.status !== 'ACTIVE') {
        throw new ForbiddenException('Cette marque est suspendue ou supprimée.');
      }
      return brandId;
    }

    throw new ForbiddenException('Accès interdit');
  }

  /** Only BRAND or BRAND_OWNER (not BRAND_STAFF). */
  private async assertBrandOwner(user: AuthUser, brandId?: number): Promise<number> {
    const role = (user?.role ?? '').toUpperCase();
    if (role !== 'BRAND' && role !== 'BRAND_OWNER') {
      throw new ForbiddenException('Réservé au propriétaire de la marque');
    }
    return this.resolveBrandId(user, brandId);
  }

  private generateTempPassword(length = 10): string {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const special = '!@#$%';
    let s = '';
    for (let i = 0; i < length - 1; i++) s += chars[Math.floor(Math.random() * chars.length)];
    s += special[Math.floor(Math.random() * special.length)];
    return s.split('').sort(() => Math.random() - 0.5).join('');
  }

  async createStaff(user: AuthUser, body: { email: string; name?: string }, brandId?: number) {
    const bid = await this.assertBrandOwner(user, brandId);
    const email = this.normalizeEmail(body?.email ?? '');
    if (!email) throw new BadRequestException('Email obligatoire');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('Format email invalide');

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new BadRequestException('Cet email est déjà utilisé');

    const name = this.cleanText(body?.name, 200) || email.split('@')[0] || 'Employé';
    const tempPassword = this.generateTempPassword(10);
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const staff = await this.prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        role: 'BRAND_STAFF',
        brandId: bid,
        mustChangePassword: true,
        tempPasswordIssuedAt: now,
        tempPasswordExpiresAt: expiresAt,
        isActive: true,
        balanceCents: 0,
      },
    });

    return {
      id: staff.id,
      email: staff.email,
      tempPassword,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async listStaff(user: AuthUser, brandId?: number) {
    const bid = await this.assertBrandOwner(user, brandId);
    const staff = await this.prisma.user.findMany({
      where: { brandId: bid, role: 'BRAND_STAFF' },
      select: { id: true, email: true, name: true, isActive: true, createdAt: true, lastActiveAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return { staff };
  }

  async disableStaff(user: AuthUser, staffId: number, brandId?: number) {
    const bid = await this.assertBrandOwner(user, brandId);
    const staff = await this.prisma.user.findUnique({ where: { id: staffId } });
    if (!staff || staff.brandId !== bid || staff.role !== 'BRAND_STAFF') {
      throw new NotFoundException('Employé introuvable');
    }
    await this.prisma.user.update({
      where: { id: staffId },
      data: { isActive: false },
    });
    return { success: true, message: 'Employé désactivé' };
  }

  async enableStaff(user: AuthUser, staffId: number, brandId?: number) {
    const bid = await this.assertBrandOwner(user, brandId);
    const staff = await this.prisma.user.findUnique({ where: { id: staffId } });
    if (!staff || staff.brandId !== bid || staff.role !== 'BRAND_STAFF') {
      throw new NotFoundException('Employé introuvable');
    }
    await this.prisma.user.update({
      where: { id: staffId },
      data: { isActive: true },
    });
    return { success: true, message: 'Employé réactivé' };
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
                  remainingCents: available,
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

  /**
   * Upload logo image: save file to uploads/logos, update brand.logoUrl, return brand.
   */
  async uploadLogo(
    user: AuthUser,
    file: { buffer: Buffer; mimetype: string; size: number; originalname?: string } | undefined,
    brandId?: number,
  ) {
    const bid = await this.resolveBrandId(user, brandId);
    if (!file || !file.buffer) {
      throw new BadRequestException('Aucun fichier image envoyé. Choisissez une image (JPG, PNG, WebP ou GIF).');
    }
    if (!ALLOWED_LOGO_MIMES.includes(file.mimetype)) {
      throw new BadRequestException('Format non autorisé. Utilisez JPG, PNG, WebP ou GIF.');
    }
    if (file.size > MAX_LOGO_SIZE_BYTES) {
      throw new BadRequestException('Image trop lourde (max 2 Mo).');
    }

    const ext = file.mimetype === 'image/jpeg' ? '.jpg' : file.mimetype === 'image/png' ? '.png' : file.mimetype === 'image/webp' ? '.webp' : '.gif';
    const dir = path.join(process.cwd(), 'uploads', 'logos');
    fs.mkdirSync(dir, { recursive: true });
    const filename = `${bid}-${Date.now()}${ext}`;
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, file.buffer);

    // Store path only so every client (web, mobile) can prefix with their API base URL
    const logoUrl = `/uploads/logos/${filename}`;

    const updated = await this.prisma.brand.update({
      where: { id: bid },
      data: { logoUrl },
    });

    return {
      success: true,
      logoUrl,
      brand: {
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
        description: updated.description,
        logoUrl: updated.logoUrl,
        website: updated.website,
        coverUrl: updated.coverUrl,
        subscriptionStatus: updated.subscriptionStatus,
        trialEndsAt: updated.trialEndsAt,
        plan: updated.plan,
      },
    };
  }

  /**
   * Upload cover image: save file to uploads/covers, update brand.coverUrl, return brand.
   */
  async uploadCover(
    user: AuthUser,
    file: { buffer: Buffer; mimetype: string; size: number; originalname?: string } | undefined,
    brandId?: number,
  ) {
    const bid = await this.resolveBrandId(user, brandId);
    if (!file || !file.buffer) {
      throw new BadRequestException('Aucun fichier image envoyé. Choisissez une image (JPG, PNG, WebP ou GIF).');
    }
    if (!ALLOWED_LOGO_MIMES.includes(file.mimetype)) {
      throw new BadRequestException('Format non autorisé. Utilisez JPG, PNG, WebP ou GIF.');
    }
    if (file.size > MAX_LOGO_SIZE_BYTES) {
      throw new BadRequestException('Image trop lourde (max 2 Mo).');
    }

    const ext = file.mimetype === 'image/jpeg' ? '.jpg' : file.mimetype === 'image/png' ? '.png' : file.mimetype === 'image/webp' ? '.webp' : '.gif';
    const dir = path.join(process.cwd(), 'uploads', 'covers');
    fs.mkdirSync(dir, { recursive: true });
    const filename = `${bid}-${Date.now()}${ext}`;
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, file.buffer);

    const coverUrl = `/uploads/covers/${filename}`;

    const updated = await this.prisma.brand.update({
      where: { id: bid },
      data: { coverUrl },
    });

    return {
      success: true,
      coverUrl,
      brand: {
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
        description: updated.description,
        logoUrl: updated.logoUrl,
        website: updated.website,
        coverUrl: updated.coverUrl,
        subscriptionStatus: updated.subscriptionStatus,
        trialEndsAt: updated.trialEndsAt,
        plan: updated.plan,
      },
    };
  }

  /**
   * Recharge le budget de la marque (auto-dépôt).
   * amountCents doit être > 0.
   * CentralPool.totalDepositedCents += amount (invariant with SUM BrandBudget.totalDepositedCents).
   */
  async depositBudget(user: AuthUser, amountCents: number, brandId?: number) {
    const bid = await this.resolveBrandId(user, brandId);
    const amount = Math.floor(Number(amountCents ?? 0));
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Montant invalide (doit être > 0)');
    }

    const budget = await this.prisma.$transaction(async (tx) => {
      const b = await tx.brandBudget.upsert({
        where: { brandId: bid },
        create: {
          brandId: bid,
          totalDepositedCents: amount,
          reservedForMissionsCents: 0,
          spentCents: 0,
        },
        update: { totalDepositedCents: { increment: amount } },
      });
      await tx.centralPool.upsert({
        where: { id: 1 },
        create: {
          id: 1,
          totalDepositedCents: amount,
          reservedLiabilityCents: 0,
          totalSpentCents: 0,
          platformRevenueCents: 0,
          platformMarginCents: 0,
          platformAvailableCents: 0,
          platformSpentCents: 0,
        },
        update: { totalDepositedCents: { increment: amount } },
      });
      return b;
    });

    const total = Number(budget.totalDepositedCents);
    const reserved = Number(budget.reservedForMissionsCents);
    const spent = Number(budget.spentCents);
    const available = Math.max(0, total - reserved - spent);

    return {
      success: true,
      message: 'Budget rechargé ✅',
      budget: {
        totalBudgetCents: total,
        lockedCents: reserved,
        availableCents: available,
        remainingCents: available,
      },
    };
  }

  /**
   * Preview topup: propose une répartition en cartes (20$ puis 10$).
   * POST /brands/me/budget/topup/preview
   */
  async topupPreview(user: AuthUser, amountCents: number, brandId?: number) {
    const bid = await this.resolveBrandId(user, brandId);
    const amount = Math.floor(Number(amountCents ?? 0));
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Montant invalide (doit être > 0)');
    }
    // Favoriser 20$ puis 10$ (optionnel 50$)
    const n20 = Math.floor(amount / 2000);
    const rest = amount - n20 * 2000;
    const n10 = Math.floor(rest / 1000);
    const remainder = rest - n10 * 1000;
    const denominations: { valueCents: number; quantity: number }[] = [
      { valueCents: 2000, quantity: n20 },
      { valueCents: 1000, quantity: n10 },
    ];
    const q50 = Math.floor(remainder / 5000);
    if (q50 > 0 && TOPUP_ALLOWED_DENOMINATIONS_CENTS.includes(5000)) {
      denominations.push({ valueCents: 5000, quantity: q50 });
    }
    const totalCents = denominations.reduce((s, d) => s + d.valueCents * d.quantity, 0);
    return { amountCents: amount, denominations, totalCents };
  }

  /**
   * Confirm topup: valide les dénominations, crédite le budget et crée les cartes cadeaux (transaction atomique).
   * POST /brands/me/budget/topup/confirm
   */
  async topupConfirm(
    user: AuthUser,
    body: { amountCents: number; denominations: { valueCents: number; quantity: number }[] },
    brandId?: number,
  ) {
    const bid = await this.resolveBrandId(user, brandId);
    const amount = Math.floor(Number(body?.amountCents ?? 0));
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Montant invalide (doit être > 0)');
    }
    const denoms = body?.denominations ?? [];
    if (!Array.isArray(denoms) || denoms.length === 0) {
      throw new BadRequestException('Dénominations manquantes');
    }
    let sum = 0;
    for (const d of denoms) {
      const value = Math.floor(Number(d.valueCents));
      const qty = Math.floor(Number(d.quantity ?? 0));
      if (!TOPUP_ALLOWED_DENOMINATIONS_CENTS.includes(value) || qty < 0) {
        throw new BadRequestException(`Dénomination non autorisée ou quantité invalide: ${value}¢ x ${qty}`);
      }
      sum += value * qty;
    }
    if (sum !== amount) {
      throw new BadRequestException(`Le total des cartes (${sum / 100}$) doit être égal au montant (${amount / 100}$)`);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const b = await tx.brandBudget.upsert({
        where: { brandId: bid },
        create: {
          brandId: bid,
          totalDepositedCents: amount,
          reservedForMissionsCents: 0,
          spentCents: 0,
        },
        update: { totalDepositedCents: { increment: amount } },
      });
      await tx.centralPool.upsert({
        where: { id: 1 },
        create: {
          id: 1,
          totalDepositedCents: amount,
          reservedLiabilityCents: 0,
          totalSpentCents: 0,
          platformRevenueCents: 0,
          platformMarginCents: 0,
          platformAvailableCents: 0,
          platformSpentCents: 0,
        },
        update: { totalDepositedCents: { increment: amount } },
      });

      let createdCount = 0;
      for (const d of denoms) {
        if (d.quantity <= 0) continue;
        const valueCents = Math.floor(Number(d.valueCents));
        const qty = Math.floor(Number(d.quantity));
        const giftCard = await tx.giftCard.upsert({
          where: {
            uniq_brand_value: { brandId: bid, valueCents },
          },
          create: { brandId: bid, valueCents },
          update: {},
        });
        for (let i = 0; i < qty; i++) {
          const code = this.generateGiftCardCode(bid, valueCents);
          await tx.giftCardInventoryItem.create({
            data: { giftCardId: giftCard.id, code, status: 'AVAILABLE' },
          });
          createdCount++;
        }
      }

      const total = Number(b.totalDepositedCents);
      const reserved = Number(b.reservedForMissionsCents);
      const spent = Number(b.spentCents);
      const available = Math.max(0, total - reserved - spent);

      return {
        creditedCents: amount,
        createdGiftcardsCount: createdCount,
        denominations: denoms,
        brandBudgetAfterCents: available,
      };
    });

    return {
      success: true,
      creditedCents: result.creditedCents,
      createdGiftcardsCount: result.createdGiftcardsCount,
      denominations: result.denominations,
      brandBudgetAfterCents: result.brandBudgetAfterCents,
    };
  }

  private generateGiftCardCode(brandId: number, valueCents: number): string {
    const r = crypto.randomBytes(4).toString('hex');
    const t = Date.now().toString(36);
    return `AQ-${brandId}-${valueCents}-${t}-${r}`.toUpperCase();
  }

  // Update brand profile fields (settings)
  async updateBrandMe(user: AuthUser, payload: any, brandId?: number) {
    const resolvedBrandId = await this.resolveBrandId(user, brandId);
    const updates: Prisma.BrandUpdateInput = {
      description: this.cleanText(payload?.description, 2000),
      website: this.cleanUrl(payload?.website),
      logoUrl: this.cleanUrl(payload?.logoUrl),
      coverUrl: this.cleanUrl(payload?.coverUrl),
      ...(payload?.category !== undefined && { category: normalizeCategory(payload.category) }),
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
      platform?: string;
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
    if (!/^https?:\/\//i.test(actionUrl)) {
      throw new BadRequestException('Lien invalide (doit commencer par http:// ou https://)');
    }
    this.assertSocialUrl(actionUrl);

    const userRewardCents = Number(mt.userRewardCents ?? 0);
    const brandCostCents = Number(mt.brandCostCents ?? 0);
    const totalBrandDebitCents = brandCostCents * qty;
    const totalUserRewardCents = userRewardCents * qty;
    const platformMarginCents = 10 * qty; // 0.10$ per mission (spec)

    const budget = await this.prisma.brandBudget.findUnique({ where: { brandId: bid } });
    if (!budget) {
      throw new BadRequestException('Aucun budget marque. Rechargez le budget avant de créer une mission.');
    }
    const available =
      Number(budget.totalDepositedCents) -
      Number(budget.reservedForMissionsCents) -
      Number(budget.spentCents);
    if (available < totalBrandDebitCents) {
      throw new BadRequestException(
        `Budget insuffisant pour ${qty} missions (besoin ${(totalBrandDebitCents / 100).toFixed(2)}$). Rechargez le budget ou baissez la quantité.`,
      );
    }

    const platform = data.platform ? String(data.platform).toUpperCase() : null;
    const validPlatforms = ['INSTAGRAM', 'FACEBOOK', 'TIKTOK'];
    const platformVal = platform && validPlatforms.includes(platform) ? platform : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.brandBudget.update({
        where: { brandId: bid },
        data: { reservedForMissionsCents: { increment: totalBrandDebitCents } },
      });

      await tx.centralPool.upsert({
        where: { id: 1 },
        create: {
          id: 1,
          totalDepositedCents: 0,
          reservedLiabilityCents: totalBrandDebitCents,
          totalSpentCents: 0,
          platformRevenueCents: 0,
          platformMarginCents,
          platformAvailableCents: platformMarginCents,
          platformSpentCents: 0,
        },
        update: {
          reservedLiabilityCents: { increment: totalBrandDebitCents },
          platformMarginCents: { increment: platformMarginCents },
          platformAvailableCents: { increment: platformMarginCents },
        },
      });

      await tx.mission.create({
        data: {
          brandId: bid,
          missionTypeId: mtId,
          title,
          description,
          actionUrl,
          platform: platformVal,
          quantityTotal: qty,
          quantityRemaining: qty,
          status: 'PENDING_APPROVAL',
        },
      });
    });

    const mission = await this.prisma.mission.findFirst({
      where: { brandId: bid, title, actionUrl },
      orderBy: { createdAt: 'desc' },
      include: { missionType: true },
    });

    await this.analyticsService.logEvent({
      userId: user.id,
      role: user.role ?? undefined,
      eventName: EventNames.platform_margin_earned,
      entityType: EntityTypes.BRAND,
      entityId: bid,
      metadata: {
        margin_cents: platformMarginCents,
        quantity: qty,
        brand_id: bid,
        mission_type_code: mt.code ?? undefined,
        platform: platformVal ?? undefined,
      },
    });

    return { success: true, mission: mission!, totalCostCents: totalBrandDebitCents };
  }

  /**
   * Create a mixed campaign: one Campaign + multiple Missions in one transaction.
   * Budget: TotalCost = sum(quantity * brandCostCents); internalFeeCents = items.length * 10; TotalDebit = TotalCost + internalFeeCents.
   */
  async createCampaign(
    user: AuthUser,
    data: {
      brandId?: number;
      name: string;
      objective?: string;
      durationDays: number;
      platforms?: string[];
      items: Array<{
        type: string;
        quantity: number;
        actionUrl: string;
        title?: string;
        description?: string;
      }>;
    },
  ) {
    const bid = await this.resolveBrandId(user, data.brandId);
    const name = (data.name ?? '').trim();
    if (!name) throw new BadRequestException('Nom de campagne obligatoire');
    const durationDays = Math.max(1, Math.floor(Number(data.durationDays ?? 0)));
    const platforms = Array.isArray(data.platforms) ? data.platforms.map((p) => String(p).toLowerCase()) : [];
    const items = Array.isArray(data.items) ? data.items : [];
    if (items.length === 0) throw new BadRequestException('Au moins un type de mission (items) obligatoire');

    const validPlatforms = ['instagram', 'facebook', 'tiktok'];
    const platformVal = platforms.length > 0
      ? platforms.filter((p) => validPlatforms.includes(p)).map((p) => p.toUpperCase())
      : null;

    const missionTypes = await this.prisma.missionType.findMany({ where: { isActive: true } });
    const typeByCode = new Map(missionTypes.map((mt) => [mt.code.toUpperCase(), mt]));

    let totalCostCents = 0;
    const resolved: Array<{ missionType: typeof missionTypes[0]; quantity: number; actionUrl: string; title: string; description: string }> = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const code = (item.type ?? '').trim().toUpperCase();
      const mt = typeByCode.get(code);
      if (!mt) throw new BadRequestException(`Type de mission invalide: ${item.type}`);
      const qty = Math.max(0, Math.floor(Number(item.quantity ?? 0)));
      if (!qty) throw new BadRequestException(`Quantité obligatoire pour l'item ${i + 1}`);
      const actionUrl = (item.actionUrl ?? '').trim();
      if (!actionUrl) throw new BadRequestException(`Lien social obligatoire pour l'item ${i + 1}`);
      if (!/^https?:\/\//i.test(actionUrl)) throw new BadRequestException(`Lien invalide pour l'item ${i + 1}`);
      this.assertSocialUrl(actionUrl);
      const title = (item.title ?? '').trim() || `${mt.label} - ${code}`;
      const description = (item.description ?? '').trim() || `Mission ${code}`;
      totalCostCents += Number(mt.brandCostCents) * qty;
      resolved.push({ missionType: mt, quantity: qty, actionUrl, title, description });
    }

    const internalFeeCents = items.length * 10; // 0.10$ per mission type (item)
    const totalDebitCents = totalCostCents + internalFeeCents;

    const [budget, brand] = await Promise.all([
      this.prisma.brandBudget.findUnique({ where: { brandId: bid } }),
      this.prisma.brand.findUnique({ where: { id: bid }, select: { status: true } }),
    ]);
    if (!budget) throw new BadRequestException('Aucun budget marque. Rechargez le budget avant de créer une campagne.');
    const available =
      Number(budget.totalDepositedCents) - Number(budget.reservedForMissionsCents) - Number(budget.spentCents);
    if (available < totalDebitCents) {
      throw new BadRequestException(
        `Budget insuffisant. Besoin: ${(totalDebitCents / 100).toFixed(2)} $ (dont ${(internalFeeCents / 100).toFixed(2)} $ de frais plateforme). Rechargez ou réduisez les quantités.`,
      );
    }

    // Pilot: missions published immediately (ACTIVE) if brand is ACTIVE; else PENDING_APPROVAL (future-proof).
    const missionStatus = brand?.status === 'ACTIVE' ? 'ACTIVE' : 'PENDING_APPROVAL';

    const now = new Date();
    const endsAt = new Date(now);
    endsAt.setDate(endsAt.getDate() + durationDays);

    const campaign = await this.prisma.$transaction(async (tx) => {
      const camp = await tx.campaign.create({
        data: {
          brandId: bid,
          name,
          objective: this.cleanText(data.objective, 500),
          platforms: platforms.length > 0 ? (platforms as any) : undefined,
          totalBudgetCents: totalDebitCents,
          durationDays,
          status: 'ACTIVE',
          startsAt: now,
          endsAt,
        },
      });

      for (const r of resolved) {
        await tx.mission.create({
          data: {
            brandId: bid,
            missionTypeId: r.missionType.id,
            campaignId: camp.id,
            title: r.title,
            description: r.description,
            actionUrl: r.actionUrl,
            platform: platformVal ? platformVal[0] ?? null : null,
            quantityTotal: r.quantity,
            quantityRemaining: r.quantity,
            status: missionStatus,
          },
        });
      }

      await tx.brandBudget.update({
        where: { brandId: bid },
        data: { reservedForMissionsCents: { increment: totalDebitCents } },
      });

      await tx.centralPool.upsert({
        where: { id: 1 },
        create: {
          id: 1,
          totalDepositedCents: 0,
          reservedLiabilityCents: totalCostCents,
          totalSpentCents: 0,
          platformRevenueCents: internalFeeCents,
          platformMarginCents: internalFeeCents,
          platformAvailableCents: internalFeeCents,
          platformSpentCents: 0,
        },
        update: {
          reservedLiabilityCents: { increment: totalCostCents },
          platformRevenueCents: { increment: internalFeeCents },
          platformMarginCents: { increment: internalFeeCents },
          platformAvailableCents: { increment: internalFeeCents },
        },
      });

      return camp;
    });

    const missions = await this.prisma.mission.findMany({
      where: { campaignId: campaign.id },
      include: { missionType: true },
      orderBy: { id: 'asc' },
    });

    await this.analyticsService.logEvent({
      userId: user.id,
      role: user.role ?? undefined,
      eventName: EventNames.platform_margin_earned,
      entityType: EntityTypes.BRAND,
      entityId: bid,
      metadata: {
        campaign_id: campaign.id,
        margin_cents: internalFeeCents,
        items_count: items.length,
        total_cost_cents: totalCostCents,
        total_debit_cents: totalDebitCents,
      },
    });

    return {
      success: true,
      campaign: { id: campaign.id, name: campaign.name, status: campaign.status, createdAt: campaign.createdAt },
      missions: missions.map((m) => ({
        id: m.id,
        title: m.title,
        missionTypeCode: m.missionType?.code,
        quantityTotal: m.quantityTotal,
        quantityRemaining: m.quantityRemaining,
        status: m.status,
      })),
      totalCostCents,
      internalFeeCents,
      totalDebitCents,
    };
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

  // -----------------------------
  // BRAND: Campaign list / get / stats
  // -----------------------------
  async listCampaigns(user: AuthUser, brandId?: number) {
    const bid = await this.resolveBrandId(user, brandId);
    const campaigns = await this.prisma.campaign.findMany({
      where: { brandId: bid },
      include: {
        missions: { include: { missionType: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return {
      campaigns: campaigns.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        totalBudgetCents: c.totalBudgetCents,
        durationDays: c.durationDays,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        createdAt: c.createdAt,
        missionsCount: c.missions.length,
      })),
    };
  }

  async getCampaign(user: AuthUser, campaignId: number, brandId?: number) {
    const bid = await this.resolveBrandId(user, brandId);
    const id = Number(campaignId);
    if (!Number.isFinite(id) || id <= 0) throw new BadRequestException('campaignId invalide');
    const campaign = await this.prisma.campaign.findFirst({
      where: { id, brandId: bid },
      include: {
        missions: { include: { missionType: true } },
      },
    });
    if (!campaign) throw new NotFoundException('Campagne introuvable');
    return {
      id: campaign.id,
      name: campaign.name,
      objective: campaign.objective,
      platforms: campaign.platforms,
      status: campaign.status,
      totalBudgetCents: campaign.totalBudgetCents,
      durationDays: campaign.durationDays,
      startsAt: campaign.startsAt,
      endsAt: campaign.endsAt,
      createdAt: campaign.createdAt,
      missions: campaign.missions.map((m) => ({
        id: m.id,
        title: m.title,
        missionTypeCode: m.missionType?.code,
        quantityTotal: m.quantityTotal,
        quantityRemaining: m.quantityRemaining,
        status: m.status,
      })),
    };
  }

  async getCampaignStats(user: AuthUser, campaignId: number, brandId?: number) {
    const bid = await this.resolveBrandId(user, brandId);
    const id = Number(campaignId);
    if (!Number.isFinite(id) || id <= 0) throw new BadRequestException('campaignId invalide');
    const campaign = await this.prisma.campaign.findFirst({
      where: { id, brandId: bid },
      include: { missions: { include: { missionType: true } } },
    });
    if (!campaign) throw new NotFoundException('Campagne introuvable');

    const missionIds = campaign.missions.map((m) => m.id);
    if (missionIds.length === 0) {
      const missionTypesEmpty = await this.prisma.missionType.findMany({
        where: { isActive: true },
        select: { code: true, brandCostCents: true },
      });
      const costPerAction: Record<string, number> = {};
      for (const mt of missionTypesEmpty) {
        costPerAction[mt.code.toUpperCase()] = Number(mt.brandCostCents ?? 0);
      }
      return {
        campaignId: campaign.id,
        campaignName: campaign.name,
        status: campaign.status,
        budgetCents: campaign.totalBudgetCents,
        spentCents: 0,
        remainingCents: campaign.totalBudgetCents,
        actions: {} as Record<string, { completed: number; target: number }>,
        costPerAction,
        dailyProgress: [] as Array<{ date: string; actions: number }>,
      };
    }

    const [approvedAttempts, missionTypes] = await Promise.all([
      this.prisma.missionAttempt.findMany({
        where: { missionId: { in: missionIds }, status: 'APPROVED' },
        select: { id: true, missionId: true, reviewedAt: true, createdAt: true },
      }),
      this.prisma.missionType.findMany({ where: { isActive: true }, select: { code: true, brandCostCents: true } }),
    ]);

    const attemptIds = approvedAttempts.map((a) => a.id);
    const walletCredits =
      attemptIds.length === 0
        ? []
        : await this.prisma.walletTransaction.findMany({
            where: { type: 'CREDIT', attemptId: { in: attemptIds } },
            select: { amountCents: true, attemptId: true },
          });
    const spentCents = walletCredits.reduce((s, w) => s + Number(w.amountCents), 0);

    const missionById = new Map(campaign.missions.map((m) => [m.id, m]));
    const actions: Record<string, { completed: number; target: number }> = {};
    for (const m of campaign.missions) {
      const code = (m.missionType?.code ?? 'UNKNOWN').toUpperCase();
      if (!actions[code]) {
        actions[code] = { completed: 0, target: 0 };
      }
      actions[code].target += m.quantityTotal;
    }
    for (const a of approvedAttempts) {
      const mission = missionById.get(a.missionId);
      if (!mission) continue;
      const code = (mission.missionType?.code ?? 'UNKNOWN').toUpperCase();
      if (actions[code]) actions[code].completed += 1;
    }

    const costPerAction: Record<string, number> = {};
    for (const mt of missionTypes) {
      const code = mt.code.toUpperCase();
      costPerAction[code] = Number(mt.brandCostCents ?? 0);
    }
    for (const m of campaign.missions) {
      const code = (m.missionType?.code ?? 'UNKNOWN').toUpperCase();
      if (m.missionType?.brandCostCents != null) costPerAction[code] = Number(m.missionType.brandCostCents);
    }

    const dateCount = new Map<string, number>();
    for (const a of approvedAttempts) {
      const d = (a.reviewedAt ?? a.createdAt);
      const key = d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
      dateCount.set(key, (dateCount.get(key) ?? 0) + 1);
    }
    const dailyProgress = Array.from(dateCount.entries())
      .map(([date, count]) => ({ date, actions: count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const remainingCents = Math.max(0, campaign.totalBudgetCents - spentCents);

    return {
      campaignId: campaign.id,
      campaignName: campaign.name,
      status: campaign.status,
      budgetCents: campaign.totalBudgetCents,
      spentCents,
      remainingCents,
      actions,
      costPerAction,
      dailyProgress,
    };
  }

  // -----------------------------
  // BRAND: Settings (ROI assumptions)
  // -----------------------------
  async getBrandSettings(user: AuthUser, brandId?: number) {
    const bid = await this.resolveBrandId(user, brandId);
    const row = await this.prisma.brandSettings.findUnique({
      where: { brandId: bid },
    });
    if (!row) {
      return {
        brandId: bid,
        avgOrderValueCents: 0,
        visitRateBps: 800,
        leadRateBps: 200,
        purchaseRateBps: 150,
      };
    }
    return {
      brandId: row.brandId,
      avgOrderValueCents: row.avgOrderValueCents,
      visitRateBps: row.defaultVisitRateBps,
      leadRateBps: row.defaultLeadRateBps,
      purchaseRateBps: row.defaultPurchaseRateBps,
    };
  }

  async updateBrandSettings(
    user: AuthUser,
    body: {
      avgOrderValueCents?: number;
      visitRateBps?: number;
      leadRateBps?: number;
      purchaseRateBps?: number;
    },
    brandId?: number,
  ) {
    const bid = await this.resolveBrandId(user, brandId);
    const aov = body.avgOrderValueCents !== undefined ? Math.max(0, Math.floor(Number(body.avgOrderValueCents))) : undefined;
    const visitBps = body.visitRateBps !== undefined ? Math.max(0, Math.min(10000, Math.floor(Number(body.visitRateBps)))) : undefined;
    const leadBps = body.leadRateBps !== undefined ? Math.max(0, Math.min(10000, Math.floor(Number(body.leadRateBps)))) : undefined;
    const purchaseBps = body.purchaseRateBps !== undefined ? Math.max(0, Math.min(10000, Math.floor(Number(body.purchaseRateBps)))) : undefined;
    if (visitBps !== undefined && (visitBps < 0 || visitBps > 10000))
      throw new BadRequestException('visitRateBps doit être entre 0 et 10000');
    if (leadBps !== undefined && (leadBps < 0 || leadBps > 10000))
      throw new BadRequestException('leadRateBps doit être entre 0 et 10000');
    if (purchaseBps !== undefined && (purchaseBps < 0 || purchaseBps > 10000))
      throw new BadRequestException('purchaseRateBps doit être entre 0 et 10000');
    await this.prisma.brandSettings.upsert({
      where: { brandId: bid },
      create: {
        brandId: bid,
        avgOrderValueCents: aov ?? 0,
        defaultVisitRateBps: visitBps ?? 800,
        defaultLeadRateBps: leadBps ?? 200,
        defaultPurchaseRateBps: purchaseBps ?? 150,
      },
      update: {
        ...(aov !== undefined && { avgOrderValueCents: aov }),
        ...(visitBps !== undefined && { defaultVisitRateBps: visitBps }),
        ...(leadBps !== undefined && { defaultLeadRateBps: leadBps }),
        ...(purchaseBps !== undefined && { defaultPurchaseRateBps: purchaseBps }),
      },
    });
    return this.getBrandSettings(user, brandId);
  }
}
