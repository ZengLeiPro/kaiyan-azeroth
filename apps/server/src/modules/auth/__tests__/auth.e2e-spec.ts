import { NestExpressApplication } from '@nestjs/platform-express';
import { hash } from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { createTestApp } from '../../../test/setup-app';

describe('Auth E2E', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let _testUserId: string;
  const testPassword = 'Test@123456';

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  }, 30000);

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await prisma.cleanDatabase();

    // 创建测试角色和用户
    const role = await prisma.role.create({
      data: {
        code: 'ADMIN',
        name: '管理员',
        status: 'active',
        permissions: {
          create: {
            module: 'crm',
            menu: 'customers',
            view: true,
            create: true,
            edit: true,
            delete: true,
            viewScope: 'ALL',
          },
        },
      },
    });

    const passwordHash = await hash(testPassword, 4);
    // push 6: user 表已删，登录字段直接挂在 employee 上
    const employee = await prisma.employee.create({
      data: {
        serialNumber: `E2E_AUTH_${Date.now()}`,
        name: '测试用户',
        username: 'testuser',
        password: passwordHash,
        canLogin: true,
        loginStatus: 'active',
        userRoles: { create: { roleId: role.id } },
      },
    });
    _testUserId = employee.id;
  });

  describe('POST /api/v1/auth/login', () => {
    it('should return tokens on successful login', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: 'testuser', password: testPassword });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
      expect(res.body).toHaveProperty('expiresIn');
      expect(res.body.user).toHaveProperty('username', 'testuser');
      expect(res.body.user).not.toHaveProperty('password');
    });

    it('should return 401 on wrong password', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: 'testuser', password: 'WrongPassword' });

      expect(res.status).toBe(401);
    });

    it('should return 401 for non-existent user', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: 'nobody', password: testPassword });

      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('should refresh tokens with valid refresh token', async () => {
      // 先登录获取 tokens
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: 'testuser', password: testPassword });

      const { refreshToken } = loginRes.body;

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
    });

    it('should reject access token used as refresh token', async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: 'testuser', password: testPassword });

      const { accessToken } = loginRes.body;

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: accessToken });

      expect(res.status).toBe(401);
    });
  });

  describe('Protected routes', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/customers');

      expect(res.status).toBe(401);
    });

    it('should allow access with valid token', async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: 'testuser', password: testPassword });

      const { accessToken } = loginRes.body;

      const res = await request(app.getHttpServer())
        .get('/api/v1/customers')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('should return current user info', async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: 'testuser', password: testPassword });

      const { accessToken } = loginRes.body;

      const res = await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('username', 'testuser');
      expect(res.body).not.toHaveProperty('password');
    });
  });
});
