import { Test, TestingModule } from '@nestjs/testing';
import { AiService } from './ai.service';
import { AiClientService } from './ai-client.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AiService', () => {
  let service: AiService;
  let aiClient: AiClientService;
  let prisma: PrismaService;

  const mockPrisma = {
    aiAuditLog: { create: jest.fn().mockResolvedValue({ id: 1 }) },
  };

  beforeEach(async () => {
    process.env.AI_ENABLED = 'false'; // use fallback in tests
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        {
          provide: AiClientService,
          useValue: { complete: jest.fn().mockResolvedValue(null) },
        },
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<AiService>(AiService);
    aiClient = module.get<AiClientService>(AiClientService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('campaignBuilder (AI_ENABLED=false)', () => {
    it('returns fallback campaign structure within budget', async () => {
      const result = await service.campaignBuilder(
        { objective: 'Test', budgetCents: 10000, durationDays: 7, platforms: ['instagram'] },
        1,
        99,
      );
      expect(result.campaignName).toBeDefined();
      expect(Array.isArray(result.recommendedMissions)).toBe(true);
      expect(result.budgetBreakdown).toBeDefined();
      expect(result.budgetBreakdown!.totalDebitCents).toBeLessThanOrEqual(10000);
      expect(result.notes).toBeDefined();
    });

    it('audits the call', async () => {
      await service.campaignBuilder(
        { objective: 'Audit test', budgetCents: 5000, durationDays: 14, platforms: [] },
        1,
        2,
      );
      expect(prisma.aiAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'CAMPAIGN_BUILDER',
            brandId: 1,
            userId: 2,
          }),
        }),
      );
    });
  });

  describe('mobileCoach (AI_ENABLED=false)', () => {
    it('returns fallback checklist and tip', async () => {
      const result = await service.mobileCoach('LIKE', 10);
      expect(Array.isArray(result.checklist)).toBe(true);
      expect(result.checklist.length).toBeGreaterThan(0);
      expect(typeof result.tip).toBe('string');
    });
  });

  describe('riskSummary', () => {
    it('returns summary and suggestedActions when AI disabled', async () => {
      const result = await service.riskSummary(
        { items: [{ userId: 1, email: 'u@test.com', riskScore: 2, submitsLastHour: 15, rejectRate: 0.5 }] },
        1,
      );
      expect(result.summary).toBeDefined();
      expect(Array.isArray(result.suggestedActions)).toBe(true);
    });
  });
});
