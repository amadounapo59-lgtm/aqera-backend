import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const mockPrisma = { $queryRawUnsafe: jest.fn().mockResolvedValue([{ 1: 1 }]) };
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return AQERA backend OK message', () => {
      expect(appController.getHello()).toEqual({ message: 'AQERA backend OK' });
    });
  });

  describe('health', () => {
    it('should return ok and db up when DB is reachable', async () => {
      await expect(appController.health()).resolves.toEqual({ ok: true, db: 'up' });
    });
  });
});
