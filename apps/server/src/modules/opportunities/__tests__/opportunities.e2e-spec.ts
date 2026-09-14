import { NestExpressApplication } from '@nestjs/platform-express';
import { hash } from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { createTestApp } from '../../../test/setup-app';

describe('Opportunities E2E', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let accessToken: string;
  let testCustomerId: string;
  let testEmployeeId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  }, 30000);

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await prisma.cleanDatabase();

    // 创建测试用户
    const role = await prisma.role.create({
      data: {
        code: 'ADMIN',
        name: '管理员',
        status: 'active',
        permissions: {
          create: [
            {
              module: 'crm',
              menu: 'customers',
              view: true,
              create: true,
              edit: true,
              delete: true,
              viewScope: 'ALL',
            },
            {
              module: 'crm',
              menu: 'opportunities',
              view: true,
              create: true,
              edit: true,
              delete: true,
              viewScope: 'ALL',
            },
          ],
        },
      },
    });

    const passwordHash = await hash('Test@123456', 4);
    // push 6: user 表已删，登录字段挂在 employee 上
    const employee = await prisma.employee.create({
      data: {
        serialNumber: `E2E_OPP_${Date.now()}`,
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

    // 创建测试客户（商机的外键依赖）—— 与 createCustomerSchema 必填项保持一致
    const customerRes = await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        customerName: 'E2E商机测试客户',
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

    testCustomerId = customerRes.body.id;
  });

  describe('CRUD with products', () => {
    it('should create opportunity with products', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/opportunities')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          opportunityName: 'E2E测试商机',
          customerId: testCustomerId,
          opportunityStage: '商务谈判',
          opportunityAmount: '1',
          winRate: '75',
          chargerId: testEmployeeId,
          expectedDealDate: '2026-12-31',
          products: [
            { productName: '产品A', quantity: '10', unitPrice: '5000', subtotalAmount: '50000' },
            { productName: '产品B', quantity: '5', unitPrice: '10000', subtotalAmount: '50000' },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.opportunityName).toBe('E2E测试商机');
      expect(res.body.opportunityAmount).toBe(100000);
      expect(res.body.products).toHaveLength(2);
    });

    it('should update opportunity and replace products', async () => {
      // 创建
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/opportunities')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          opportunityName: '更新测试商机',
          customerId: testCustomerId,
          opportunityStage: '商务谈判',
          opportunityAmount: '100',
          chargerId: testEmployeeId,
          expectedDealDate: '2026-12-31',
          products: [
            { productName: '旧产品', quantity: '1', unitPrice: '100', subtotalAmount: '100' },
          ],
        });

      const oppId = createRes.body.id;
      const version = createRes.body.version;

      // 更新（全量替换产品）
      const updateRes = await request(app.getHttpServer())
        .put(`/api/v1/opportunities/${oppId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          opportunityName: '已更新商机',
          version,
          products: [
            {
              productName: '新产品A',
              quantity: '1',
              unitPrice: '1234.56',
              subtotalAmount: '1234.56',
            },
            {
              productName: '新产品B',
              quantity: '1',
              unitPrice: '765.44',
              subtotalAmount: '765.44',
            },
          ],
        });

      expect(updateRes.status).toBe(200);
      // 注意：opportunityName 由后端按「客户名-日期-金额」无条件重新生成，dto.opportunityName 被忽略
      expect(updateRes.body.opportunityName).toMatch(/ - ¥2000\.00$/);
      expect(updateRes.body.opportunityAmount).toBe(2000);
      expect(updateRes.body.products).toHaveLength(2);
      expect(updateRes.body.products.map((p: { productName: string }) => p.productName)).toContain(
        '新产品A'
      );
    });

    it('should reject empty products array on update (products 改必填后至少 1 项)', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/opportunities')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          opportunityName: '不可清空产品商机',
          customerId: testCustomerId,
          opportunityStage: '商务谈判',
          opportunityAmount: '100',
          chargerId: testEmployeeId,
          expectedDealDate: '2026-12-31',
          products: [
            { productName: '保留的产品', quantity: '1', unitPrice: '100', subtotalAmount: '100' },
          ],
        });

      const oppId = createRes.body.id;
      const version = createRes.body.version;

      const updateRes = await request(app.getHttpServer())
        .put(`/api/v1/opportunities/${oppId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ version, products: [] });

      // createOpportunitySchema.products 已收紧为 min(1)，empty array 应被 schema 拒绝
      expect(updateRes.status).toBe(400);
    });
  });

  describe('Decimal precision', () => {
    it('should preserve Decimal precision in round-trip', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/opportunities')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          opportunityName: '精度测试商机',
          customerId: testCustomerId,
          opportunityStage: '商务谈判',
          opportunityAmount: '99999.99',
          winRate: '75.5',
          chargerId: testEmployeeId,
          expectedDealDate: '2026-12-31',
          products: [
            {
              productName: '精度产品',
              quantity: '1',
              unitPrice: '99999.99',
              subtotalAmount: '99999.99',
            },
          ],
        });

      expect(createRes.status).toBe(201);

      const getRes = await request(app.getHttpServer())
        .get(`/api/v1/opportunities/${createRes.body.id}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.opportunityAmount).toBe(99999.99);
      expect(getRes.body.winRate).toBe(75.5);
    });
  });

  describe('Validation', () => {
    it('should return 400 for missing required fields', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/opportunities')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('Soft delete', () => {
    it('should soft delete and return 404 on get', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/opportunities')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          opportunityName: '删除测试商机',
          customerId: testCustomerId,
          opportunityStage: '商务谈判',
          opportunityAmount: '100',
          chargerId: testEmployeeId,
          expectedDealDate: '2026-12-31',
          products: [
            { productName: '待删除产品', quantity: '1', unitPrice: '100', subtotalAmount: '100' },
          ],
        });

      const oppId = createRes.body.id;
      const version = createRes.body.version;

      await request(app.getHttpServer())
        .delete(`/api/v1/opportunities/${oppId}`)
        .query({ version })
        .set('Authorization', `Bearer ${accessToken}`);

      const getRes = await request(app.getHttpServer())
        .get(`/api/v1/opportunities/${oppId}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(getRes.status).toBe(404);
    });
  });

  describe('输单流失校验与 lostDate 自动回填', () => {
    it('create 时 stage=输单流失 但未填失单原因 → 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/opportunities')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          opportunityName: '直接输单',
          customerId: testCustomerId,
          opportunityStage: '输单流失',
          opportunityAmount: '100',
          chargerId: testEmployeeId,
          expectedDealDate: '2026-12-31',
          products: [{ productName: 'X', quantity: '1', unitPrice: '100', subtotalAmount: '100' }],
        });

      expect(res.status).toBe(400);
    });

    it('update stage→输单流失 时未传 loseReason → 400（service 层兜底）', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/opportunities')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          opportunityName: '活跃商机',
          customerId: testCustomerId,
          opportunityStage: '商务谈判',
          opportunityAmount: '100',
          chargerId: testEmployeeId,
          expectedDealDate: '2026-12-31',
          products: [{ productName: 'X', quantity: '1', unitPrice: '100', subtotalAmount: '100' }],
        });
      expect(createRes.status).toBe(201);
      const oppId = createRes.body.id;

      // 只改 stage 不传 loseReason，应该被拒
      const updateRes = await request(app.getHttpServer())
        .put(`/api/v1/opportunities/${oppId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          opportunityStage: '输单流失',
          version: createRes.body.version,
        });

      expect(updateRes.status).toBe(400);
    });

    it('update stage→输单流失 且传 loseReason 时成功 + lostDate 自动回填', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/opportunities')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          opportunityName: '即将输单',
          customerId: testCustomerId,
          opportunityStage: '商务谈判',
          opportunityAmount: '100',
          chargerId: testEmployeeId,
          expectedDealDate: '2026-12-31',
          products: [{ productName: 'X', quantity: '1', unitPrice: '100', subtotalAmount: '100' }],
        });
      expect(createRes.status).toBe(201);
      const oppId = createRes.body.id;

      const updateRes = await request(app.getHttpServer())
        .put(`/api/v1/opportunities/${oppId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          opportunityStage: '输单流失',
          loseReason: '价格 / 预算不足',
          version: createRes.body.version,
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.opportunityStage).toBe('输单流失');
      expect(updateRes.body.loseReason).toBe('价格 / 预算不足');
      // 未传 lostDate → 应被 service 自动回填
      expect(updateRes.body.lostDate).toBeTruthy();
    });

    it('回改非 LOST 阶段时保留 lostDate（策略：保留）', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/opportunities')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          opportunityName: '反复横跳商机',
          customerId: testCustomerId,
          opportunityStage: '商务谈判',
          opportunityAmount: '100',
          chargerId: testEmployeeId,
          expectedDealDate: '2026-12-31',
          products: [{ productName: 'X', quantity: '1', unitPrice: '100', subtotalAmount: '100' }],
        });
      const oppId = createRes.body.id;

      // 先切到 LOST 并填原因
      const lostRes = await request(app.getHttpServer())
        .put(`/api/v1/opportunities/${oppId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          opportunityStage: '输单流失',
          loseReason: '价格 / 预算不足',
          version: createRes.body.version,
        });
      expect(lostRes.status).toBe(200);
      const lostDateSnapshot = lostRes.body.lostDate;
      expect(lostDateSnapshot).toBeTruthy();

      // 改回商务谈判：service 不动 lostDate（未显式传值），应保留
      const reviveRes = await request(app.getHttpServer())
        .put(`/api/v1/opportunities/${oppId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          opportunityStage: '商务谈判',
          version: lostRes.body.version,
        });
      expect(reviveRes.status).toBe(200);
      expect(reviveRes.body.opportunityStage).toBe('商务谈判');
      expect(reviveRes.body.lostDate).toBe(lostDateSnapshot);
    });

    it('策略 C：现存 LOST 商机若 loseReason 为空，下次任何编辑都被强制要求补原因', async () => {
      // 制造一条「stage=输单流失 但 loseReason 为空」的脏数据（绕过 service 直接 prisma 写入）
      const dirty = await prisma.opportunity.create({
        data: {
          serialNumber: `E2E_DIRTY_${Date.now()}`,
          opportunityName: '历史脏数据',
          customerId: testCustomerId,
          opportunityStage: '输单流失',
          opportunityAmount: '100',
          loseReason: null,
          chargerId: testEmployeeId,
        },
      });

      // 用户只想改 remark，不动 stage 也不动 loseReason → 应被 service.assertLostReasonOnLost 拦截
      const updateRes = await request(app.getHttpServer())
        .put(`/api/v1/opportunities/${dirty.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          remark: '随手改个备注',
          version: dirty.version,
        });

      expect(updateRes.status).toBe(400);

      // 补上 loseReason 后应该能继续更新
      const fixedRes = await request(app.getHttpServer())
        .put(`/api/v1/opportunities/${dirty.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          loseReason: '其他',
          loseReasonDetail: '历史归档补录',
          remark: '随手改个备注',
          version: dirty.version,
        });

      expect(fixedRes.status).toBe(200);
      expect(fixedRes.body.loseReason).toBe('其他');
      expect(fixedRes.body.loseReasonDetail).toBe('历史归档补录');
    });
  });
});
