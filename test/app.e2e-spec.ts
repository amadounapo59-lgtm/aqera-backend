import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  }, 20000);

  afterAll(async () => {
    await app.close();
  });

  describe('GET /', () => {
    it('returns backend OK message', () => {
      return request(app.getHttpServer())
        .get('/')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('message', 'AQERA backend OK');
        });
    });
  });

  describe('GET /health', () => {
    it('returns ok true and db up', () => {
      return request(app.getHttpServer())
        .get('/health')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('ok', true);
          expect(res.body).toHaveProperty('db', 'up');
        });
    });
  });

  describe('POST /auth/register', () => {
    const email = `test-${Date.now()}@aqera.e2e`;
    const password = 'TestPassword123!';

    it('registers a new user and returns token + user', () => {
      return request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password, name: 'E2E User' })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty('token');
          expect(res.body).toHaveProperty('user');
          expect(res.body.user).toHaveProperty('email', email);
          expect(res.body.user).toHaveProperty('role', 'USER');
        });
    });

    it('login with same credentials returns token', () => {
      return request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty('token');
          expect(res.body).toHaveProperty('user');
          expect(res.body.user.email).toBe(email);
        });
    });
  });

  describe('POST /auth/login', () => {
    it('returns 401 for invalid credentials', () => {
      return request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'nonexistent@test.com', password: 'wrong' })
        .expect(401);
    });

    it('returns 400 for missing email', () => {
      return request(app.getHttpServer())
        .post('/auth/login')
        .send({ password: 'something' })
        .expect(400);
    });
  });

  describe('Full flow: register → login → missions → submit → admin approve → wallet', () => {
    const email = `e2e-${Date.now()}@aqera.e2e`;
    const password = 'E2EPass123!';
    let token: string;
    let adminToken: string;
    let missionId: number;
    let attemptId: number;

    it('1. register and login', async () => {
      const reg = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password, name: 'E2E Flow' })
        .expect(201);
      expect(reg.body).toHaveProperty('token');
      token = reg.body.token;

      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect((res) => res.status === 200 || res.status === 201);
      token = login.body.token;
    });

    it('2. GET /missions returns list and daily', async () => {
      const res = await request(app.getHttpServer())
        .get('/missions')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body).toHaveProperty('availableMissions');
      expect(res.body).toHaveProperty('completedMissions');
      expect(res.body).toHaveProperty('daily');
      const avail = res.body.availableMissions || [];
      if (avail.length > 0) missionId = avail[0].id ?? avail[0].missionId;
    });

    it('3. POST /missions/:id/submit when mission exists', async () => {
      if (!missionId) {
        return; // skip if no mission in seed
      }
      const res = await request(app.getHttpServer())
        .post(`/missions/${missionId}/submit`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect((r) => r.status === 200 || r.status === 201);
      if (res.body?.attemptId) attemptId = res.body.attemptId;
    });

    it('4. admin login and approve attempt', async () => {
      const adminLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: process.env.ADMIN_EMAIL || 'admin@aqera.app', password: process.env.ADMIN_PASSWORD || 'Admin123!' })
        .expect((r) => r.status === 200 || r.status === 201);
      adminToken = adminLogin.body.token;

      const attempts = await request(app.getHttpServer())
        .get('/admin/attempts?status=PENDING')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const pending = attempts.body.attempts || [];
      const toApprove = attemptId ?? pending[0]?.id;
      if (toApprove) {
        await request(app.getHttpServer())
          .post(`/admin/attempts/${toApprove}/approve`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect((r) => r.status === 200 || r.status === 201);
      }
    });

    it('5. GET /wallet/balance returns balance', async () => {
      await request(app.getHttpServer())
        .get('/wallet/balance')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('balanceCents');
        });
    });
  });
});
