import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class GiftcardsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const giftCards = await this.prisma.giftCard.findMany({
      orderBy: [{ brand: 'asc' }, { valueCents: 'asc' }],
    });
    return { giftCards };
  }

  private makeCode() {
    return 'AQERA-' + Math.random().toString(36).substring(2, 10).toUpperCase();
  }

  async purchaseByUserId(userId: number, giftCardId: number, clientRequestId?: string) {
    if (!Number.isFinite(userId) || userId <= 0) throw new BadRequestException('userId invalide');
    if (!Number.isFinite(giftCardId) || giftCardId <= 0) throw new BadRequestException('giftCardId invalide');

    // ✅ Idempotency : si on reçoit le même Idempotency-Key -> on renvoie l'achat existant
    if (clientRequestId) {
      const existing = await this.prisma.giftCardPurchase.findUnique({
        where: { clientRequestId },
        include: { giftCard: true },
      });

      if (existing) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        return {
          success: true,
          message: 'Achat déjà traité ✅',
          giftCard: existing.giftCard,
          purchase: existing,
          balanceCents: user?.balanceCents ?? 0,
        };
      }
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('Utilisateur introuvable');

    const gift = await this.prisma.giftCard.findUnique({ where: { id: giftCardId } });
    if (!gift) throw new BadRequestException('Carte cadeau introuvable');

    if ((user.balanceCents ?? 0) < gift.valueCents) {
      throw new BadRequestException('Solde insuffisant');
    }

    const code = this.makeCode();

    return this.prisma.$transaction(async (tx) => {
      // 1) Create purchase
      const purchase = await tx.giftCardPurchase.create({
        data: {
          userId,
          giftCardId,
          code,
          clientRequestId: clientRequestId || undefined,
          status: 'ACTIVE',
          purchasedAt: new Date(),
        },
        include: { giftCard: true },
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
          note: `GiftCard purchase: ${gift.brand} ${(gift.valueCents / 100).toFixed(2)}$`,
          giftCardId: gift.id,
        },
      });

      // 4) Central pool accounting (global)
      await tx.centralPool.upsert({
        where: { id: 1 },
        create: {
          id: 1,
          totalDepositedCents: 0,
          reservedLiabilityCents: 0,
          totalSpentCents: gift.valueCents,
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
        giftCard: purchase.giftCard,
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
      include: { giftCard: true },
      orderBy: { purchasedAt: 'desc' },
      take: 200,
    });

    return { purchases };
  }

  async usePurchase(purchaseId: number, usedByUserId?: number) {
    if (!Number.isFinite(purchaseId) || purchaseId <= 0) throw new BadRequestException('purchaseId invalide');

    const purchase = await this.prisma.giftCardPurchase.findUnique({
      where: { id: purchaseId },
      include: { giftCard: true },
    });

    if (!purchase) throw new BadRequestException('Achat introuvable');
    if (purchase.status !== 'ACTIVE') throw new BadRequestException('Carte déjà utilisée');

    const updated = await this.prisma.giftCardPurchase.update({
      where: { id: purchaseId },
      data: {
        status: 'USED',
        usedAt: new Date(),
        usedByUserId: usedByUserId ? Number(usedByUserId) : undefined,
      },
      include: { giftCard: true },
    });

    return {
      success: true,
      message: 'Carte validée ✅',
      purchase: updated,
      giftCard: updated.giftCard,
    };
  }

  async redeemByCode(code: string, usedByUserId?: number) {
    const cleaned = (code ?? '').trim();
    if (!cleaned) throw new BadRequestException('Code manquant');

    const purchase = await this.prisma.giftCardPurchase.findUnique({
      where: { code: cleaned },
      include: { giftCard: true },
    });

    if (!purchase) throw new BadRequestException('Code invalide');
    if (purchase.status !== 'ACTIVE') throw new BadRequestException('Carte déjà utilisée');

    const updated = await this.prisma.giftCardPurchase.update({
      where: { id: purchase.id },
      data: {
        status: 'USED',
        usedAt: new Date(),
        usedByUserId: usedByUserId ? Number(usedByUserId) : undefined,
      },
      include: { giftCard: true },
    });

    return {
      success: true,
      message: 'Carte validée ✅',
      purchase: updated,
      giftCard: updated.giftCard,
    };
  }
}