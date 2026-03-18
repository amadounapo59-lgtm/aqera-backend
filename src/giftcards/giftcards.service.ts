import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { securityConfig } from '../security/security.config';

@Injectable()
export class GiftcardsService {
  constructor(private readonly prisma: PrismaService) {}
  private mapGiftCard(g: any) {
    const brand = g?.brand ?? null;
    const brandObj = brand
      ? {
          id: brand.id,
          name: brand.name,
          slug: brand.slug ?? null,
          logoUrl: brand.logoUrl ?? null,
          coverUrl: brand.coverUrl ?? null,
          website: brand.website ?? null,
          // adresse visible côté mobile (données issues de la dernière application approuvée)
          address: Array.isArray(brand.applications) && brand.applications[0]?.address ? brand.applications[0].address : null,
          city: Array.isArray(brand.applications) && brand.applications[0]?.city ? brand.applications[0].city : null,
        }
      : null;

    return {
      id: g.id,
      valueCents: g.valueCents,
      createdAt: g.createdAt,
      // ✅ temporary dual fields for smooth front transition
      brandName: brand?.name ?? g.brandName ?? 'Unknown',
      brand: brandObj,
      // optional convenience (old clients)
      brandSlug: brand?.slug ?? null,
      brandCoverUrl: brand?.coverUrl ?? null,
    };
  }

  private mapPurchase(p: any) {
    const giftCard = p?.giftCard ? this.mapGiftCard(p.giftCard) : null;
    return {
      id: p.id,
      status: p.status,
      code: p.code,
      purchasedAt: p.purchasedAt,
      usedAt: p.usedAt ?? null,
      brandName: giftCard?.brandName ?? p?.giftCard?.brand?.name ?? null,
      valueCents: p?.giftCard?.valueCents ?? giftCard?.valueCents ?? null,
      giftCard,
    };
  }


  /**
   * Liste des cartes cadeaux visibles côté utilisateur (boutique).
   * Inclut toutes les cartes (marques ACTIVE ou non) pour que les cartes créées au topup soient visibles.
   */
  async findAll() {
    const giftCards = await this.prisma.giftCard.findMany({
      include: {
        brand: {
          include: {
            applications: {
              where: { status: 'APPROVED' as any },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        },
      },
      orderBy: [{ brandId: 'asc' }, { valueCents: 'asc' }],
    });

    return { giftCards: giftCards.map((g) => this.mapGiftCard(g)) };
  }


  async purchaseByUserId(userId: number, giftCardId: number, clientRequestId?: string) {
    if (!Number.isFinite(userId) || userId <= 0) throw new BadRequestException('userId invalide');
    if (!Number.isFinite(giftCardId) || giftCardId <= 0) throw new BadRequestException('giftCardId invalide');

    // ✅ Idempotency : si on reçoit le même Idempotency-Key -> on renvoie l'achat existant
    if (clientRequestId) {
      const existing = await this.prisma.giftCardPurchase.findUnique({
        where: { clientRequestId },
        include: { giftCard: { include: { brand: true } } },
      });

      if (existing) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        return {
          success: true,
          message: 'Achat déjà traité ✅',
          giftCard: this.mapGiftCard(existing.giftCard),
          purchase: existing,
          balanceCents: user?.balanceCents ?? 0,
        };
      }
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('Utilisateur introuvable');
    if (securityConfig.requireEmailVerifiedForPurchase && !(user as any).emailVerified) {
      throw new ForbiddenException({
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Vérifie ton e-mail pour acheter des cartes cadeaux.',
      });
    }

    const gift = await this.prisma.giftCard.findUnique({
      where: { id: giftCardId },
      include: { brand: true },
    });
    if (!gift) throw new BadRequestException('Carte cadeau introuvable');

    const available = (user as any).availableCents ?? user.balanceCents ?? 0;
    if (available < gift.valueCents) {
      throw new BadRequestException('Solde insuffisant');
    }

    return this.prisma.$transaction(async (tx) => {
      // 0) Pick an AVAILABLE real code from inventory
      const inv = await tx.giftCardInventoryItem.findFirst({
        where: { giftCardId: gift.id, status: 'AVAILABLE' },
        orderBy: { id: 'asc' },
      });
      if (!inv) throw new BadRequestException('Stock de codes épuisé pour cette carte');

      // 1) Create purchase

      const purchase = await tx.giftCardPurchase.create({
        data: {
          userId,
          giftCardId,
          code: inv.code,
          inventoryItemId: inv.id,
          clientRequestId: clientRequestId || undefined,
          status: 'ACTIVE',
          purchasedAt: new Date(),
        },
        include: { giftCard: { include: { brand: true } } },
      });

      // 1b) Mark inventory code as ISSUED
      await tx.giftCardInventoryItem.update({
        where: { id: inv.id },
        data: { status: 'ISSUED', issuedAt: new Date(), purchaseId: purchase.id },
      });

      // 2) Debit user available balance (keep balanceCents in sync)
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          balanceCents: { decrement: gift.valueCents },
          availableCents: { decrement: gift.valueCents },
        },
      });

      // 3) Ledger entry (WalletTransaction)
      await tx.walletTransaction.create({
        data: {
          userId,
          type: 'DEBIT',
          amountCents: gift.valueCents,
          note: `GiftCard purchase: ${gift.brand.name} ${(gift.valueCents / 100).toFixed(2)}$`,
          giftCardId: gift.id,
        },
      });

      // 3b) BrandBudget accounting (gift card value consumed for this brand)
      await tx.brandBudget.upsert({
        where: { brandId: gift.brandId },
        create: {
          brandId: gift.brandId,
          totalDepositedCents: gift.valueCents,
          reservedForMissionsCents: 0,
          spentCents: gift.valueCents,
        },
        update: { spentCents: { increment: gift.valueCents } },
      });

      // 4) Central pool accounting (global)
      await tx.centralPool.upsert({
        where: { id: 1 },
        create: {
          id: 1,
          totalDepositedCents: 0,
          reservedLiabilityCents: 0,
          totalSpentCents: gift.valueCents,
          platformRevenueCents: 0,
        },
        update: {
          // When user spends, liability decreases; spent increases
          reservedLiabilityCents: { decrement: gift.valueCents },
          totalSpentCents: { increment: gift.valueCents },
        },
      });

      return {
        success: true,
        message: 'Achat confirmé ✅',
        giftCard: this.mapGiftCard(purchase.giftCard),
        purchase: {
          id: purchase.id,
          status: purchase.status,
          code: purchase.code,
          purchasedAt: purchase.purchasedAt,
        },
        balanceCents: updatedUser.balanceCents,
      };
    });
  }

  async getMyPurchases(userId: number, status?: string) {
    if (!Number.isFinite(userId) || userId <= 0) throw new BadRequestException('userId invalide');

    const purchases = await this.prisma.giftCardPurchase.findMany({
      where: {
        userId,
        ...(status ? { status: status as any } : {}),
      },
      include: { giftCard: { include: { brand: true } } },
      orderBy: { purchasedAt: 'desc' },
      take: 200,
    });

    return { purchases: purchases.map((p) => this.mapPurchase(p)) };
  }

  async usePurchase(purchaseId: number, usedByUserId?: number) {
    if (!Number.isFinite(purchaseId) || purchaseId <= 0) throw new BadRequestException('purchaseId invalide');

    const purchase = await this.prisma.giftCardPurchase.findUnique({
      where: { id: purchaseId },
      include: { giftCard: { include: { brand: true } }, inventoryItem: true },
    });

    if (!purchase) throw new BadRequestException('Achat introuvable');
    if (purchase.status !== 'ACTIVE') throw new BadRequestException('Carte déjà utilisée');

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const up = await tx.giftCardPurchase.update({
        where: { id: purchaseId },
        data: {
          status: 'USED',
          usedAt: now,
          usedByUserId: usedByUserId ? Number(usedByUserId) : undefined,
        },
        include: { giftCard: { include: { brand: true } } },
      });
      if (purchase.inventoryItemId) {
        await tx.giftCardInventoryItem.update({
          where: { id: purchase.inventoryItemId },
          data: { status: 'USED', usedAt: now },
        });
      }
      return up;
    });

    return {
      success: true,
      message: 'Carte validée ✅',
      purchase: this.mapPurchase(updated),
      giftCard: this.mapGiftCard(updated.giftCard),
    };
  }

  async redeemByCode(code: string, usedByUserId?: number, brandId?: number | null) {
    const cleaned = (code ?? '').trim();
    if (!cleaned) throw new BadRequestException('Code manquant');

    const purchase = await this.prisma.giftCardPurchase.findUnique({
      where: { code: cleaned },
      include: { giftCard: { include: { brand: true } } },
    });

    if (!purchase) throw new BadRequestException('Code invalide');
    if (purchase.status !== 'ACTIVE') throw new BadRequestException('Carte déjà utilisée');
    if (brandId != null && purchase.giftCard.brandId !== brandId) {
      throw new ForbiddenException('Cette carte n’appartient pas à votre marque');
    }

    const updated = await this.prisma.giftCardPurchase.update({
      where: { id: purchase.id },
      data: {
        status: 'USED',
        usedAt: new Date(),
        usedByUserId: usedByUserId ? Number(usedByUserId) : undefined,
      },
      include: { giftCard: { include: { brand: true } } },
    });

    // Mark inventory code as USED (if linked)
    if (updated.inventoryItemId) {
      await this.prisma.giftCardInventoryItem.update({
        where: { id: updated.inventoryItemId },
        data: { status: 'USED', usedAt: new Date() },
      });
    }

    return {
      success: true,
      message: 'Carte validée ✅',
      purchase: this.mapPurchase(updated),
      giftCard: this.mapGiftCard(updated.giftCard),
    };
  }
}