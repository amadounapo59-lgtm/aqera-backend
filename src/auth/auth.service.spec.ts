import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed'),
  compare: jest.fn().mockResolvedValue(true),
}));

describe('AuthService', () => {
  let service: AuthService;
  let prisma: jest.Mocked<Pick<PrismaService, 'user'>>;
  let jwt: jest.Mocked<Pick<JwtService, 'sign'>>;

  const userSelect = {
    id: 1,
    email: 'user@test.com',
    name: 'User',
    balanceCents: 0,
    badgeLevel: 'STARTER',
    dailyCapCents: 1000,
    role: 'USER',
    brandId: null,
    agencyId: null,
    mustChangePassword: false,
    createdAt: new Date(),
  };

  beforeEach(async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed');

    const mockPrisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    const mockJwt = { sign: jest.fn().mockReturnValue('token') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = module.get(PrismaService) as any;
    jwt = module.get(JwtService) as any;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    it('should register a new user and return token + user', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.user.create as jest.Mock).mockResolvedValue(userSelect);

      const result = await service.register('user@test.com', 'TestPass123!', 'User');

      expect(result).toHaveProperty('token', 'token');
      expect(result).toHaveProperty('user', userSelect);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'user@test.com' } });
      expect(bcrypt.hash).toHaveBeenCalledWith('TestPass123!', 10);
      expect(prisma.user.create).toHaveBeenCalled();
      expect(jwt.sign).toHaveBeenCalled();
    });

    it('should normalize email to lowercase', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.user.create as jest.Mock).mockResolvedValue(userSelect);

      await service.register('  User@Test.COM  ', 'TestPass123!');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'user@test.com' } });
    });

    it('should throw BadRequestException when email is empty', async () => {
      await expect(service.register('', 'TestPass123!')).rejects.toThrow(BadRequestException);
      await expect(service.register('   ', 'TestPass123!')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when password is too short', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.register('u@t.com', 'short')).rejects.toThrow(BadRequestException);
      await expect(service.register('u@t.com', '')).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException when email already exists', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 1 });

      await expect(service.register('user@test.com', 'TestPass123!')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('should return token and user when credentials are valid', async () => {
      (prisma.user.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: 1, email: 'user@test.com', passwordHash: 'hashed', role: 'USER' })
        .mockResolvedValueOnce(userSelect);

      const result = await service.login('user@test.com', 'password123');

      expect(result.token).toBe('token');
      expect(result.user).toEqual(userSelect);
      expect(bcrypt.compare).toHaveBeenCalledWith('password123', 'hashed');
    });

    it('should throw BadRequestException when email is empty', async () => {
      await expect(service.login('', 'pwd')).rejects.toThrow(BadRequestException);
      await expect(service.login('   ', 'pwd')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when password is missing', async () => {
      await expect(service.login('u@t.com', '')).rejects.toThrow(BadRequestException);
    });

    it('should throw UnauthorizedException when user not found', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.login('unknown@test.com', 'password123')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException when password is wrong', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        email: 'u@t.com',
        passwordHash: 'hashed',
        role: 'USER',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login('u@t.com', 'wrong')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('changePassword', () => {
    it('should update password and return success', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 1, passwordHash: 'hashed' });
      (prisma.user.update as jest.Mock).mockResolvedValue({});

      const result = await service.changePassword(1, 'NewPass123!');

      expect(result).toMatchObject({ success: true, message: 'Mot de passe mis à jour ✅' });
      expect(bcrypt.hash).toHaveBeenCalledWith('NewPass123!', 10);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({
            passwordHash: 'hashed',
            mustChangePassword: false,
            tempPasswordIssuedAt: null,
            tempPasswordExpiresAt: null,
          }),
        }),
      );
    });

    it('should throw BadRequestException when userId is invalid', async () => {
      await expect(service.changePassword(0, 'NewPass123!')).rejects.toThrow(BadRequestException);
      await expect(service.changePassword(-1, 'NewPass123!')).rejects.toThrow(BadRequestException);
      await expect(service.changePassword(NaN, 'NewPass123!')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when new password is too short', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 1, passwordHash: 'hashed' });
      await expect(service.changePassword(1, 'short')).rejects.toThrow(BadRequestException);
      await expect(service.changePassword(1, '')).rejects.toThrow(BadRequestException);
    });
  });
});
