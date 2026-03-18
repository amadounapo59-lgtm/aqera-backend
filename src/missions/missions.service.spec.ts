import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { MissionsService } from './missions.service';
import { PrismaService } from '../prisma/prisma.service';

describe('MissionsService', () => {
  let service: MissionsService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const userMock = { findUnique: jest.fn(), update: jest.fn() };
    const mockPrisma = {
      user: userMock,
      mission: { findMany: jest.fn(), findUnique: jest.fn() },
      missionAttempt: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() },
      brandBudget: { findUnique: jest.fn(), update: jest.fn() },
      centralPool: { upsert: jest.fn() },
      walletTransaction: { create: jest.fn() },
      userDailyEarning: { findUnique: jest.fn() },
      $transaction: jest.fn((fn: (tx: any) => Promise<any>) => fn(mockPrisma)),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MissionsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<MissionsService>(MissionsService);
    prisma = module.get(PrismaService) as any;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findActiveForUser', () => {
    it('should throw BadRequestException when userId is invalid', async () => {
      await expect(service.findActiveForUser(0)).rejects.toThrow(BadRequestException);
      await expect(service.findActiveForUser(-1)).rejects.toThrow(BadRequestException);
      await expect(service.findActiveForUser(NaN)).rejects.toThrow(BadRequestException);
    });

    it('should return missions and daily when user exists and cap not reached', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        dailyCapCents: 1000,
        badgeLevel: 'STARTER',
      });
      (prisma.userDailyEarning.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.mission.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.missionAttempt.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.findActiveForUser(1);

      expect(result).toHaveProperty('missions');
      expect(result).toHaveProperty('daily');
      expect(result).toHaveProperty('availableMissions');
      expect(result).toHaveProperty('completedMissions');
      expect(Array.isArray(result.missions)).toBe(true);
      expect(Array.isArray(result.availableMissions)).toBe(true);
      expect(Array.isArray(result.completedMissions)).toBe(true);
    });
  });

  describe('submitAttempt', () => {
    it('should throw BadRequestException when userId is invalid', async () => {
      await expect(service.submitAttempt(0, 1)).rejects.toThrow(BadRequestException);
      await expect(service.submitAttempt(-1, 1)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when missionId is invalid', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 1, dailyCapCents: 1000 });
      (prisma.userDailyEarning.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.submitAttempt(1, 0)).rejects.toThrow(BadRequestException);
      await expect(service.submitAttempt(1, -1)).rejects.toThrow(BadRequestException);
    });
  });

  describe('getMyAttempts', () => {
    it('should throw BadRequestException when userId is invalid', async () => {
      await expect(service.getMyAttempts(0)).rejects.toThrow(BadRequestException);
    });

    it('should return attempts list when user exists', async () => {
      (prisma.missionAttempt.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getMyAttempts(1);

      expect(result).toHaveProperty('attempts');
      expect(Array.isArray(result.attempts)).toBe(true);
    });
  });
});
