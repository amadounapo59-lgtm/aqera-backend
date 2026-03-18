import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { RateLimitService } from '../security/rate-limit.service';
import { SecurityEventService } from '../security/security-event.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: jest.Mocked<AuthService>;

  beforeEach(async () => {
    const mockAuthService = {
      register: jest.fn(),
      login: jest.fn(),
      changePassword: jest.fn(),
    };
    const mockAnalytics = { logEvent: jest.fn() };
    const mockRateLimit = { hit: jest.fn().mockResolvedValue({ allowed: true, remaining: 10, resetAt: new Date() }) };
    const mockSecurityEvents = { log: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: AnalyticsService, useValue: mockAnalytics },
        { provide: RateLimitService, useValue: mockRateLimit },
        { provide: SecurityEventService, useValue: mockSecurityEvents },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get(AuthService) as any;
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('register', () => {
    it('should call authService.register with body params', async () => {
      const ret = {
        token: 't',
        user: {
          id: 1,
          email: 'u@t.com',
          name: 'Name',
          role: 'USER',
          mustChangePassword: false,
          balanceCents: 0,
          badgeLevel: 'STARTER',
          dailyCapCents: 1000,
          brandId: null,
          agencyId: null,
          createdAt: new Date(),
        },
      };
      authService.register.mockResolvedValue(ret as any);
      const mockReq = { securityContext: { ip: '127.0.0.1', deviceId: 'test-device' } };

      const result = await controller.register(mockReq as any, 'u@t.com', 'password123', 'Name');

      expect(authService.register).toHaveBeenCalledWith('u@t.com', 'password123', 'Name', undefined);
      expect(result).toEqual(ret);
    });
  });

  describe('login', () => {
    it('should call authService.login with email and password', async () => {
      const createdAt = new Date();
      const ret = {
        token: 't',
        user: {
          id: 1,
          email: 'u@t.com',
          name: 'User',
          role: 'USER',
          mustChangePassword: false,
          balanceCents: 0,
          badgeLevel: 'STARTER',
          dailyCapCents: 1000,
          brandId: null,
          agencyId: null,
          createdAt: createdAt.toISOString(),
          isActive: true,
          emailVerified: false,
          lastActiveAt: undefined,
        },
      };
      authService.login.mockResolvedValue(ret as any);
      const mockReq = { securityContext: { ip: '127.0.0.1', deviceId: 'test-device' } };

      const result = await controller.login(mockReq as any, 'u@t.com', 'password123');

      expect(authService.login).toHaveBeenCalledWith(
        'u@t.com',
        'password123',
        expect.objectContaining({ ip: expect.any(String), deviceId: expect.any(String) }),
      );
      expect(result).toEqual(ret);
    });
  });

  describe('changePassword', () => {
    it('should call authService.changePassword with req.user.id and newPassword', async () => {
      const ret = {
        success: true,
        message: 'Mot de passe mis à jour ✅',
        user: {
          id: 42,
          email: 'u@t.com',
          name: 'User',
          role: 'USER',
          mustChangePassword: false,
          balanceCents: 0,
          badgeLevel: 'STARTER',
          dailyCapCents: 1000,
          brandId: null,
          agencyId: null,
          createdAt: new Date(),
        },
      };
      authService.changePassword.mockResolvedValue(ret as any);
      const mockReq = { user: { id: 42, email: 'u@t.com' } };

      const result = await controller.changePassword(mockReq as any, '', 'newPassword123');

      expect(authService.changePassword).toHaveBeenCalledWith(42, 'newPassword123', '');
      expect(result).toEqual(ret);
    });
  });
});
