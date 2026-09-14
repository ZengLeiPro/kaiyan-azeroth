import { NestExpressApplication } from '@nestjs/platform-express';
import { hash } from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { createTestApp } from '../../../test/setup-app';

describe('Customers E2E', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let accessToken: string;
  let testEmployeeId: string;

  // 与 createCustomerSchema 必填项保持一致：customerName + industry + level + source +
  // relationship + 国/省/市/区 + chargerId。其余可选字段省略。
  const buildCustomerPayload = (customerName: string) => ({
    customerName,
    industry: '互联网/信息技术',
    customerLevel: 'A',
    customerSource: '自我开拓',
    customerRelationship: '潜在客户',
    country: '中国',
    province: '浙江省',
    city: '杭州市',
    district: '西湖区',
    chargerId: testEmployeeId,
  });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  }, 30000);

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await prisma.cleanDatabase();

    // 创建测试用户并获取 token
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

    const passwordHash = await hash('Test@123456', 4);
    // push 6: user 表已删，登录字段挂在 employee 上
    const employee = await prisma.employee.create({
      data: {
        serialNumber: `E2E_CUSTOMER_${Date.now()}`,
        name: '测试用户',
        username: 'testuser',
        password: passwordHash,
        canLogin: true,
        loginStatus: 'active',
        userRoles: { create: { roleId: role.id } },
      },
    });
    testEmployeeId = employee.id;

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: 'testuser', password: 'Test@123456' });

    accessToken = loginRes.body.accessToken;
  });

  describe('CRUD lifecycle', () => {
    it('should create, read, update, and delete a customer', async () => {
      // CREATE
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(buildCustomerPayload('E2E测试客户'));

      expect(createRes.status).toBe(201);
      expect(createRes.body).toHaveProperty('id');
      expect(createRes.body).toHaveProperty('serialNumber');
      expect(createRes.body.customerName).toBe('E2E测试客户');

      const customerId = createRes.body.id;
      const version = createRes.body.version;

      // READ (findOne)
      const getRes = await request(app.getHttpServer())
        .get(`/api/v1/customers/${customerId}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.customerName).toBe('E2E测试客户');

      // UPDATE
      const updateRes = await request(app.getHttpServer())
        .put(`/api/v1/customers/${customerId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ customerName: 'E2E更新客户', version });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.customerName).toBe('E2E更新客户');
      expect(updateRes.body.version).toBe(version + 1);

      // DELETE (soft)
      const deleteRes = await request(app.getHttpServer())
        .delete(`/api/v1/customers/${customerId}`)
        .query({ version: updateRes.body.version })
        .set('Authorization', `Bearer ${accessToken}`);

      expect(deleteRes.status).toBe(200);

      // Verify soft deleted (GET returns 404)
      const afterDeleteRes = await request(app.getHttpServer())
        .get(`/api/v1/customers/${customerId}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(afterDeleteRes.status).toBe(404);
    });
  });

  describe('POST /api/v1/customers', () => {
    it('should return 400 for missing required fields', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/customers', () => {
    it('should return paginated list', async () => {
      // 创建几个客户
      await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(buildCustomerPayload('客户A'));

      await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(buildCustomerPayload('客户B'));

      const res = await request(app.getHttpServer())
        .get('/api/v1/customers')
        .set('Authorization', `Bearer ${accessToken}`)
        .query({ page: 1, pageSize: 10 });

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);
      expect(res.body.total).toBe(2);
      expect(res.body).toHaveProperty('page', 1);
      expect(res.body).toHaveProperty('pageSize', 10);
    });

    it('should filter by keyword', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(buildCustomerPayload('示例科技'));

      await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(buildCustomerPayload('其他公司'));

      const res = await request(app.getHttpServer())
        .get('/api/v1/customers')
        .set('Authorization', `Bearer ${accessToken}`)
        .query({ keyword: '示例' });

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].customerName).toBe('示例科技');
    });
  });

  describe('Optimistic locking', () => {
    it('should return 409 on version conflict', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(buildCustomerPayload('冲突测试客户'));

      const customerId = createRes.body.id;

      // 第一次更新成功
      await request(app.getHttpServer())
        .put(`/api/v1/customers/${customerId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ customerName: '第一次更新', version: 1 });

      // 第二次用旧版本更新应冲突
      const conflictRes = await request(app.getHttpServer())
        .put(`/api/v1/customers/${customerId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ customerName: '第二次更新', version: 1 });

      expect(conflictRes.status).toBe(409);
    });

    it('restore→编辑→再删始终使用调用方快照，恢复只增加一次 version', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(buildCustomerPayload('恢复 CAS 客户'));
      const customerId = created.body.id as string;

      await request(app.getHttpServer())
        .delete(`/api/v1/customers/${customerId}`)
        .query({ version: created.body.version })
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const trash = await request(app.getHttpServer())
        .get('/api/v1/customers/trash')
        .set('Authorization', `Bearer ${accessToken}`)
        .query({ keyword: '恢复 CAS 客户', page: 1, pageSize: 10 })
        .expect(200);
      const deletedVersion = trash.body.items[0].version as number;

      const restored = await request(app.getHttpServer())
        .post(`/api/v1/customers/${customerId}/restore`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ version: deletedVersion })
        .expect(201);
      expect(restored.body.version).toBe(deletedVersion + 1);

      const edited = await request(app.getHttpServer())
        .put(`/api/v1/customers/${customerId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ customerName: '恢复后编辑客户', version: restored.body.version })
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/api/v1/customers/${customerId}`)
        .query({ version: restored.body.version })
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(409);

      await request(app.getHttpServer())
        .delete(`/api/v1/customers/${customerId}`)
        .query({ version: edited.body.version })
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
    });
  });
});
