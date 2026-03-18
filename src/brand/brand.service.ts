import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const ALLOWED_INVENTORY_STATUSES = ['AVAILABLE', 'ISSUED'];

@Injectable()
export class BrandService {
  constructor(private readonly prisma: PrismaService) {}

  /** POST /brand/redeem — Lookup: inventory first, then purchase by code. Brand ownership via brandId FK. */
  async redeemCode(userId: number, code: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, brandId: true, isActive: true },
    });
    if (!user || !user.brandId) throw new ForbiddenException('Accès refusé');
    if ((user as any).isActive === false) throw new ForbiddenException('Compte désactivé');
    const role = (user.role ?? '').toUpperCase();
    if (!['BRAND', 'BRAND_OWNER', 'BRAND_STAFF'].includes(role)) {
      throw new ForbiddenException('Réservé au personnel marque');
    }

    const cleaned = (code ?? '').trim();
    if (!cleaned) throw new BadRequestException('Code manquant');

    const staffBrandId = user.brandId;

    // 1) Priority: search in inventory (GiftCardInventoryItem) first
    const inventoryItem = await this.prisma.giftCardInventoryItem.findUnique({
      where: { code: cleaned },
      include: { giftCard: { include: { brand: true } }, purchase: true },
    });

    if (inventoryItem) {
      if (inventoryItem.status === 'USED') {
        throw new BadRequestException('Carte déjà utilisée');
      }
      if (!ALLOWED_INVENTORY_STATUSES.includes(inventoryItem.status)) {
        throw new BadRequestException('Code non valide pour rachat (statut invalide)');
      }
      if (inventoryItem.giftCard.brandId !== staffBrandId) {
        throw new ForbiddenException('Cette carte n’appartient pas à votre marque');
      }

      const now = new Date();

      if (inventoryItem.purchaseId != null && inventoryItem.purchase) {
        const purchase = inventoryItem.purchase;
        if (purchase.status === 'USED') throw new BadRequestException('Carte déjà utilisée');
        if (purchase.giftCardId !== inventoryItem.giftCardId) {
          throw new BadRequestException('Incohérence achat / inventaire');
        }
        await this.prisma.$transaction(async (tx) => {
          await tx.giftCardPurchase.update({
            where: { id: purchase.id },
            data: { status: 'USED', usedAt: now, usedByUserId: userId },
          });
          await tx.giftCardInventoryItem.update({
            where: { id: inventoryItem.id },
            data: { status: 'USED', usedAt: now, usedByUserId: userId },
          });
        });
        return {
          ok: true,
          brandName: inventoryItem.giftCard.brand.name,
          valueCents: inventoryItem.giftCard.valueCents,
          purchaseId: purchase.id,
          usedAt: now.toISOString(),
        };
      }

      // Inventory-only redeem (no linked purchase)
      await this.prisma.$transaction(async (tx) => {
        await tx.giftCardInventoryItem.update({
          where: { id: inventoryItem.id },
          data: { status: 'USED', usedAt: now, usedByUserId: userId },
        });
      });
      return {
        ok: true,
        brandName: inventoryItem.giftCard.brand.name,
        valueCents: inventoryItem.giftCard.valueCents,
        purchaseId: null,
        usedAt: now.toISOString(),
      };
    }

    // 2) Fallback: legacy lookup by GiftCardPurchase.code
    const purchase = await this.prisma.giftCardPurchase.findUnique({
      where: { code: cleaned },
      include: { giftCard: { include: { brand: true } }, inventoryItem: true },
    });
    if (!purchase) throw new NotFoundException('Code invalide');
    if (purchase.status === 'USED') throw new BadRequestException('Carte déjà utilisée');
    if (purchase.giftCard.brandId !== staffBrandId) {
      throw new ForbiddenException('Cette carte n’appartient pas à votre marque');
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.giftCardPurchase.update({
        where: { id: purchase.id },
        data: { status: 'USED', usedAt: now, usedByUserId: userId },
      });
      if (purchase.inventoryItemId) {
        await tx.giftCardInventoryItem.update({
          where: { id: purchase.inventoryItemId },
          data: { status: 'USED', usedAt: now, usedByUserId: userId },
        });
      }
    });

    return {
      ok: true,
      brandName: purchase.giftCard.brand.name,
      valueCents: purchase.giftCard.valueCents,
      purchaseId: purchase.id,
      usedAt: now.toISOString(),
    };
  }

  /** GET /brand/redeems — Last redeems for staff's brand (purchases + inventory-only). Code masked. */
  async getRedeems(userId: number, limit = 50) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { brandId: true, role: true, isActive: true },
    });
    if (!user || !user.brandId) throw new ForbiddenException('Accès refusé');
    if ((user as any).isActive === false) throw new ForbiddenException('Compte désactivé');
    const role = (user.role ?? '').toUpperCase();
    if (!['BRAND', 'BRAND_OWNER', 'BRAND_STAFF'].includes(role)) {
      throw new ForbiddenException('Réservé au personnel marque');
    }

    const take = Math.min(100, Math.max(1, limit));
    const brandId = user.brandId;

    const [purchases, inventoryOnly] = await Promise.all([
      this.prisma.giftCardPurchase.findMany({
        where: {
          giftCard: { brandId },
          status: 'USED',
          usedAt: { not: null },
        },
        orderBy: { usedAt: 'desc' },
        take,
        include: { giftCard: { select: { valueCents: true } }, usedByUser: { select: { email: true } } },
      }),
      this.prisma.giftCardInventoryItem.findMany({
        where: {
          giftCard: { brandId },
          status: 'USED',
          usedAt: { not: null },
          purchaseId: null,
        },
        orderBy: { usedAt: 'desc' },
        take,
        include: { giftCard: { select: { valueCents: true } }, usedByUser: { select: { email: true } } },
      }),
    ]);

    const fromPurchases = purchases.map((p) => ({
      code: this.maskCode(p.code),
      valueCents: p.giftCard.valueCents,
      usedAt: p.usedAt,
      usedByEmail: (p as any).usedByUser?.email ?? null,
    }));
    const fromInventory = inventoryOnly.map((i) => ({
      code: this.maskCode(i.code),
      valueCents: i.giftCard.valueCents,
      usedAt: i.usedAt,
      usedByEmail: (i as any).usedByUser?.email ?? null,
    }));

    const merged = [...fromPurchases, ...fromInventory]
      .sort((a, b) => (b.usedAt?.getTime() ?? 0) - (a.usedAt?.getTime() ?? 0))
      .slice(0, take);

    return { redeems: merged };
  }

  private maskCode(code: string): string {
    if (!code || code.length < 8) return '****';
    return code.slice(0, 4) + '***' + code.slice(-3);
  }
}
