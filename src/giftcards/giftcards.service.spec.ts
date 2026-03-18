import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { GiftcardsService } from './giftcards.service';
import { PrismaService } from '../prisma/prisma.service';

describe('GiftcardsService', () => {
  let service: GiftcardsService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const mockPrisma = {
      giftCard: { findMany: jest.fn(), findUnique: jest.fn() },
      giftCardPurchase: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      giftCardInventoryItem: { findFirst: jest.fn(), update: jest.fn() },
      user: { findUnique: jest.fn(), update: jest.fn() },
      walletTransaction: { create: jest.fn() },
      brandBudget: { upsert: jest.fn() },
      centralPool: { upsert: jest.fn() },
      $transaction: jest.fn((fn: (tx: any) => Promise<any>) => fn(mockPrisma)),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [GiftcardsService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<GiftcardsService>(GiftcardsService);
    prisma = module.get(PrismaService) as any;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return mapped giftCards list', async () => {
      const cards = [
        {
          id: 1,
          valueCents: 1000,
          createdAt: new Date(),
          brandId: 1,
          brand: { id: 1, name: 'Brand', slug: 'brand', logoUrl: null, coverUrl: null, website: null },
        },
      ];
      (prisma.giftCard.findMany as jest.Mock).mockResolvedValue(cards);

      const result = await service.findAll();

      expect(result).toHaveProperty('giftCards');
      expect(result.giftCards).toHaveLength(1);
      expect(result.giftCards[0]).toMatchObject({
        id: 1,
        valueCents: 1000,
        brandName: 'Brand',
      });
    });
  });

  describe('purchaseByUserId', () => {
    it('should throw BadRequestException when userId is invalid', async () => {
      await expect(service.purchaseByUserId(0, 1)).rejects.toThrow(BadRequestException);
      await expect(service.purchaseByUserId(-1, 1)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when giftCardId is invalid', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 1, balanceCents: 1000 });
      await expect(service.purchaseByUserId(1, 0)).rejects.toThrow(BadRequestException);
      await expect(service.purchaseByUserId(1, -1)).rejects.toThrow(BadRequestException);
    });

    it('should throw when user not found', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.purchaseByUserId(999, 1)).rejects.toThrow(BadRequestException);
    });

    it('should throw when gift card not found', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        balanceCents: 1000,
        availableCents: 1000,
        emailVerified: true,
      });
      (prisma.giftCard.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.purchaseByUserId(1, 999)).rejects.toThrow(BadRequestException);
    });
  });

  describe('getMyPurchases', () => {
    it('should throw BadRequestException when userId is invalid', async () => {
      await expect(service.getMyPurchases(0)).rejects.toThrow(BadRequestException);
    });

    it('should return purchases list', async () => {
      (prisma.giftCardPurchase.findMany as jest.Mock).mockResolvedValue([]);
      const result = await service.getMyPurchases(1);
      expect(result).toHaveProperty('purchases');
      expect(Array.isArray(result.purchases)).toBe(true);
    });
  });

  describe('redeemByCode', () => {
    it('should throw BadRequestException when code is empty', async () => {
      await expect(service.redeemByCode('')).rejects.toThrow(BadRequestException);
      await expect(service.redeemByCode('   ')).rejects.toThrow(BadRequestException);
    });

    it('should throw when purchase not found', async () => {
      (prisma.giftCardPurchase.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.redeemByCode('UNKNOWN_CODE')).rejects.toThrow(BadRequestException);
    });
  });
});
