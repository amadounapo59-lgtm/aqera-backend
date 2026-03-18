import { Test, TestingModule } from '@nestjs/testing';
import { MissionsController } from './missions.controller';
import { MissionsService } from './missions.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { RateLimitService } from '../security/rate-limit.service';
import { SecurityEventService } from '../security/security-event.service';

describe('MissionsController', () => {
  let controller: MissionsController;

  beforeEach(async () => {
    const mockAnalytics = { logEvent: jest.fn() };
    const mockRateLimit = { hit: jest.fn().mockResolvedValue({ allowed: true, remaining: 10, resetAt: new Date() }) };
    const mockSecurityEvents = { log: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MissionsController],
      providers: [
        { provide: MissionsService, useValue: {} },
        { provide: AnalyticsService, useValue: mockAnalytics },
        { provide: RateLimitService, useValue: mockRateLimit },
        { provide: SecurityEventService, useValue: mockSecurityEvents },
      ],
    }).compile();

    controller = module.get<MissionsController>(MissionsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
