import { NestExpressApplication } from '@nestjs/platform-express';
import { hash } from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaService } from '../common/prisma/prisma.service';

describe('公开候选验收：错密码 IP 限速', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.THROTTLE_LOGIN_LIMIT = '6';
    const { createTestApp } = await import('../test/setup-app');
    app = await createTestApp();
    prisma = app.get(PrismaService);
  }, 30000);

  afterAll(async () => {
    await app?.close();
  });

  it('同一 IP 超过登录限流后返回 429', async () => {
    await prisma.cleanDatabase();
    const role = await prisma.role.create({
      data: {
        code: 'ROLE_THROTTLE',
        name: '限流测试',
        status: 'active',
        permissions: {
          create: {
            module: 'crm',
            menu: 'customers',
            view: true,
            create: false,
            edit: false,
            delete: false,
            viewScope: 'SELF',
          },
        },
      },
    });
    await prisma.employee.create({
      data: {
        serialNumber: 'PUB_THROTTLE',
        name: '限流账号',
        username: 'throttle_user',
        password: await hash('Test@PublicAcceptance1', 4),
        canLogin: true,
        loginStatus: 'active',
        userRoles: { create: { roleId: role.id } },
      },
    });

    const statuses: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: 'throttle_user', password: 'WrongPassword!!' });
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
    expect(statuses.some((status) => status === 401)).toBe(true);
  });
});
