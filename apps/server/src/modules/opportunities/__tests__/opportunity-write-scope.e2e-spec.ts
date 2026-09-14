import { NestExpressApplication } from '@nestjs/platform-express';
import { hash } from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { createTestApp } from '../../../test/setup-app';

describe('商机创建数据范围矩阵 E2E', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let customerId: string;
  const tokens = new Map<string, string>();
  const employeeIds = new Map<string, string>();

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await prisma.cleanDatabase();

    const [selfRole, allRole] = await Promise.all([
      prisma.role.create({
        data: {
          code: 'E2E_SCOPE_SELF',
          name: 'E2E 本人范围',
          permissions: {
            create: {
              module: 'crm',
              menu: 'opportunities',
              view: true,
              create: true,
              viewScope: 'SELF',
            },
          },
        },
      }),
      prisma.role.create({
        data: {
          code: 'E2E_SCOPE_ALL',
          name: 'E2E 全部范围',
          permissions: {
            create: {
              module: 'crm',
              menu: 'opportunities',
              view: true,
              create: true,
              viewScope: 'ALL',
            },
          },
        },
      }),
    ]);
    const password = await hash('Test@123456', 4);
    const employees = await Promise.all(
      [
        { key: 'owner', roleId: selfRole.id },
        { key: 'collaborator', roleId: selfRole.id },
        { key: 'all', roleId: allRole.id },
        { key: 'outside', roleId: selfRole.id },
      ].map(({ key, roleId }) =>
        prisma.employee.create({
          data: {
            serialNumber: `E2E_SCOPE_${key.toUpperCase()}`,
            name: `E2E ${key}`,
            username: `e2e_scope_${key}`,
            password,
            canLogin: true,
            loginStatus: 'active',
            userRoles: { create: { roleId } },
          },
        })
      )
    );
    const [owner, collaborator] = employees;
    for (const employee of employees) {
      const key = employee.username!.replace('e2e_scope_', '');
      employeeIds.set(key, employee.id);
    }
    const customer = await prisma.customer.create({
      data: {
        serialNumber: 'E2E-SCOPE-CUSTOMER',
        customerName: 'E2E 数据范围客户',
        chargerId: owner!.id,
        collaboratorIds: [collaborator!.id],
      },
    });
    customerId = customer.id;

    for (const key of ['owner', 'collaborator', 'all', 'outside']) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: `e2e_scope_${key}`, password: 'Test@123456' });
      expect(response.status).toBe(200);
      tokens.set(key, response.body.accessToken as string);
    }
  }, 30000);

  afterAll(async () => {
    await app?.close();
  });

  const createOpportunity = (key: string, suffix: string) =>
    request(app.getHttpServer())
      .post('/api/v1/opportunities')
      .set('Authorization', `Bearer ${tokens.get(key)}`)
      .send({
        opportunityName: `E2E 范围商机 ${suffix}`,
        customerId,
        opportunityStage: '商务谈判',
        opportunityAmount: 100,
        chargerId: employeeIds.get(key),
        expectedDealDate: '2026-12-31',
        products: [{ productName: `范围产品 ${suffix}`, quantity: 1, unitPrice: 100 }],
      });

  it('SELF 负责人、协作人、ALL 可写，范围外 SELF 被拒绝', async () => {
    const ownerResult = await createOpportunity('owner', 'owner');
    const collaboratorResult = await createOpportunity('collaborator', 'collaborator');
    const allResult = await createOpportunity('all', 'all');
    const outsideResult = await createOpportunity('outside', 'outside');

    expect(ownerResult.status, JSON.stringify(ownerResult.body)).toBe(201);
    expect(collaboratorResult.status, JSON.stringify(collaboratorResult.body)).toBe(201);
    expect(allResult.status, JSON.stringify(allResult.body)).toBe(201);
    expect(outsideResult.status).toBe(403);
    expect(outsideResult.body.message).toBe('无权将商机写入该客户，或客户不存在');

    const stored = await prisma.opportunity.count({
      where: { customerId, deletedAt: null },
    });
    expect(stored).toBe(3);
  });
});
