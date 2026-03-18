import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { PrismaService } from '../prisma/prisma.service';

describe('WalletService', () => {
  let service: WalletService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const mockPrisma = {
      user: { findUnique: jest.fn(), update: jest.fn() },
      walletTransaction: { findMany: jest.fn(), create: jest.fn() },
      userDailyEarning: { findUnique: jest.fn(), findMany: jest.fn(), upsert: jest.fn() },
      $transaction: jest.fn((fn: (tx: any) => Promise<any>) => fn(mockPrisma)),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [WalletService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<WalletService>(WalletService);
    prisma = module.get(PrismaService) as any;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getUserById', () => {
    it('should throw BadRequestException when userId is invalid', async () => {
      await expect(service.getUserById(0)).rejects.toThrow(BadRequestException);
      await expect(service.getUserById(-1)).rejects.toThrow(BadRequestException);
      await expect(service.getUserById(NaN)).rejects.toThrow(BadRequestException);
    });

    it('should return user when found', async () => {
      const user = { id: 1, email: 'u@t.com', balanceCents: 100, availableCents: 100 };
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(user);

      const result = await service.getUserById(1);
      expect(result).toEqual(user);
    });

    it('should throw when user not found', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.getUserById(999)).rejects.toThrow(BadRequestException);
    });
  });

  describe('getBalanceByUserId', () => {
    it('should return balanceCents (prefer availableCents when present)', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        balanceCents: 50,
        availableCents: 80,
      });

      const result = await service.getBalanceByUserId(1);
      expect(result).toEqual({ balanceCents: 80 });
    });

    it('should fallback to balanceCents when availableCents missing', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        balanceCents: 50,
      });

      const result = await service.getBalanceByUserId(1);
      expect(result).toEqual({ balanceCents: 50 });
    });
  });

  describe('getUserByEmail', () => {
    it('should throw when email is empty', async () => {
      await expect(service.getUserByEmail('')).rejects.toThrow(BadRequestException);
      await expect(service.getUserByEmail('   ')).rejects.toThrow(BadRequestException);
    });

    it('should normalize email to lowercase', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 1 });
      await service.getUserByEmail('  User@Test.COM  ');
      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'user@test.com' } });
    });
  });
});
