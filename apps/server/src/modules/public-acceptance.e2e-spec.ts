import { NestExpressApplication } from '@nestjs/platform-express';
import { APPROVAL_EVENT_TYPE, APPROVER_TYPE, MULTI_APPROVAL_TYPE } from '@ky-azeroth/shared/constants';
import { hash } from 'bcryptjs';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaService } from '../common/prisma/prisma.service';
import { seedEmployeeUsers } from '../../prisma/seeds/05-employee-users';
import { LOGIN_FAIL_LOCK_THRESHOLD } from './auth/auth.service';
import { createTestApp } from '../test/setup-app';

const PASSWORD = 'Test@PublicAcceptance1';

function crmPermissions(viewScope: 'SELF' | 'ALL') {
  return [
    'customers',
    'contacts',
    'opportunities',
    'sale_orders',
    'payments',
    'invoices',
    'keep_records',
  ].map((menu) => ({
    module: 'crm',
    menu,
    view: true,
    create: true,
    edit: true,
    delete: true,
    export: true,
    approve: false,
    viewScope,
  }));
}

describe('公开候选验收：登录负例 / 数据范围 / 业务链 / bootstrap', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  }, 30000);

  afterAll(async () => {
    await app?.close();
  });

  async function login(username: string, password = PASSWORD) {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({
      username,
      password,
    });
    return res;
  }

  async function createEmployee(params: {
    username: string;
    name: string;
    permissions: Array<Record<string, unknown>>;
  }) {
    const role = await prisma.role.create({
      data: {
        code: `ROLE_${params.username.toUpperCase()}`,
        name: params.name,
        status: 'active',
        permissions: { create: params.permissions as never },
      },
    });
    const employee = await prisma.employee.create({
      data: {
        serialNumber: `PUB_${params.username.toUpperCase()}`,
        name: params.name,
        username: params.username,
        password: await hash(PASSWORD, 4),
        canLogin: true,
        loginStatus: 'active',
        userRoles: { create: { roleId: role.id } },
      },
    });
    return employee;
  }

  it('错密码连续失败会锁定；注销后 refresh 失效；响应不含 hash/secret/password', async () => {
    await prisma.cleanDatabase();
    await createEmployee({
      username: 'lockee',
      name: '锁定测试',
      permissions: crmPermissions('ALL'),
    });

    for (let i = 0; i < LOGIN_FAIL_LOCK_THRESHOLD; i += 1) {
      const failed = await login('lockee', 'WrongPassword!!');
      expect(failed.status).toBe(401);
      expect(JSON.stringify(failed.body)).not.toMatch(/hash|secret|password/i);
    }
    const locked = await login('lockee', PASSWORD);
    expect(locked.status).toBe(401);

    await prisma.employee.updateMany({
      where: { username: 'lockee' },
      data: { loginFailCount: 0, lockUntil: null, loginStatus: 'active' },
    });

    const ok = await login('lockee');
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toBeTruthy();
    expect(ok.body.refreshToken).toBeTruthy();
    expect(JSON.stringify(ok.body)).not.toMatch(/"password"|"tokenHash"|bcrypt/i);

    const logout = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${ok.body.accessToken}`)
      .set('x-refresh-token', ok.body.refreshToken);
    expect(logout.status).toBe(200);

    const refresh = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: ok.body.refreshToken });
    expect(refresh.status).toBe(401);
  });

  it('销售 A 看不到销售 B 的客户/商机/订单/搜索；来源枚举与跟进日期只存日；合同回款审批入账后可开票并建项目工时', async () => {
    await prisma.cleanDatabase();

    const salesA = await createEmployee({
      username: 'sales_a',
      name: '销售甲',
      permissions: crmPermissions('SELF'),
    });
    const salesB = await createEmployee({
      username: 'sales_b',
      name: '销售乙',
      permissions: crmPermissions('SELF'),
    });
    const approver = await createEmployee({
      username: 'approver',
      name: '审批员',
      permissions: [
        ...crmPermissions('ALL'),
        {
          module: 'approval',
          menu: 'approval_list',
          view: true,
          create: false,
          edit: false,
          delete: false,
          export: false,
          approve: true,
          viewScope: 'ALL',
        },
        {
          module: 'projects',
          menu: 'project_list',
          view: true,
          create: true,
          edit: true,
          delete: false,
          export: false,
          approve: false,
          viewScope: 'ALL',
        },
        {
          module: 'projects',
          menu: 'effort_records',
          view: true,
          create: true,
          edit: true,
          delete: false,
          export: false,
          approve: false,
          viewScope: 'ALL',
        },
      ],
    });
    const admin = await createEmployee({
      username: 'admin',
      name: '管理员',
      permissions: [
        ...crmPermissions('ALL'),
        {
          module: 'organization',
          menu: 'employees',
          view: true,
          create: true,
          edit: true,
          delete: true,
          export: false,
          approve: false,
          viewScope: 'ALL',
        },
        {
          module: 'projects',
          menu: 'project_list',
          view: true,
          create: true,
          edit: true,
          delete: false,
          export: false,
          approve: false,
          viewScope: 'ALL',
        },
        {
          module: 'projects',
          menu: 'effort_records',
          view: true,
          create: true,
          edit: true,
          delete: false,
          export: false,
          approve: false,
          viewScope: 'ALL',
        },
        {
          module: 'system',
          menu: 'user_account',
          view: true,
          create: false,
          edit: true,
          delete: false,
          export: false,
          approve: false,
          viewScope: 'ALL',
        },
        {
          module: 'finance',
          menu: 'ledger',
          view: true,
          create: false,
          edit: true,
          delete: false,
          export: false,
          approve: false,
          viewScope: 'ALL',
        },
      ],
    });
    const financeAdmin = await createEmployee({
      username: 'finance_admin',
      name: '财务管理员',
      permissions: [
        {
          module: 'finance',
          menu: 'ledger',
          view: true,
          create: false,
          edit: true,
          delete: false,
          export: false,
          approve: false,
          viewScope: 'ALL',
        },
      ],
    });
    process.env.SUPER_ADMIN_EMPLOYEE_ID = admin.id;

    await prisma.financeAccount.create({
      data: { code: 'cmb', name: '招商银行', kind: 'bank', displayOrder: 10 },
    });
    await prisma.financeSubject.create({
      data: {
        code: 'non_pl.uncategorized',
        name: '未分类',
        category: 'non_pl',
        level: 2,
        displayOrder: 1,
      },
    });
    const flow = await prisma.approvalFlow.create({
      data: {
        groupId: `payment_approve_${Date.now()}`,
        code: 'PAYMENT_APPROVE_V1',
        name: '回款审批',
        eventType: APPROVAL_EVENT_TYPE.PAYMENT_APPROVE,
        copyToIds: [],
        version: 1,
        status: 'active',
      },
    });
    await prisma.approvalFlowNode.create({
      data: {
        flowId: flow.id,
        nodeOrder: 1,
        nodeName: '审批节点1',
        approverType: APPROVER_TYPE.MEMBER,
        approverUserIds: [approver.id],
        managerLevel: 1,
        multiType: MULTI_APPROVAL_TYPE.OR,
      },
    });

    const tokenA = (await login('sales_a')).body.accessToken as string;
    const tokenB = (await login('sales_b')).body.accessToken as string;
    const tokenApprover = (await login('approver')).body.accessToken as string;
    const tokenAdmin = (await login('admin')).body.accessToken as string;
    expect(tokenA && tokenB && tokenApprover && tokenAdmin).toBeTruthy();

    const customerPayload = (name: string, chargerId: string) => ({
      customerName: name,
      industry: '互联网/信息技术',
      customerLevel: 'A',
      customerSource: '小红书',
      customerRelationship: '潜在客户',
      country: '中国',
      province: '浙江省',
      city: '杭州市',
      district: '西湖区',
      chargerId,
    });

    const createdA = await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(customerPayload('公开验收客户甲', salesA.id));
    expect(createdA.status, JSON.stringify(createdA.body)).toBe(201);
    const customerAId = createdA.body.id as string;

    const createdB = await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${tokenB}`)
      .send(customerPayload('公开验收客户乙', salesB.id));
    expect(createdB.status, JSON.stringify(createdB.body)).toBe(201);
    const customerBId = createdB.body.id as string;

    const listA = await request(app.getHttpServer())
      .get('/api/v1/customers')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(listA.status).toBe(200);
    const idsA = (listA.body.items as Array<{ id: string }>).map((row) => row.id);
    expect(idsA).toContain(customerAId);
    expect(idsA).not.toContain(customerBId);

    const searchB = await request(app.getHttpServer())
      .get('/api/v1/customers')
      .query({ keyword: '公开验收客户乙' })
      .set('Authorization', `Bearer ${tokenA}`);
    expect(searchB.status).toBe(200);
    expect((searchB.body.items as Array<{ id: string }>).map((row) => row.id)).not.toContain(
      customerBId
    );

    const hidden = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerBId}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect([403, 404]).toContain(hidden.status);

    const exportA = await request(app.getHttpServer())
      .get('/api/v1/customers')
      .query({ pageSize: 501 })
      .set('Authorization', `Bearer ${tokenA}`);
    expect(exportA.status).toBe(403);

    const contactB = await request(app.getHttpServer())
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ contactName: '联系人乙', customerId: customerBId });
    expect(contactB.status, JSON.stringify(contactB.body)).toBe(201);
    const opportunityB = await request(app.getHttpServer())
      .post('/api/v1/opportunities')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        opportunityName: '公开验收商机乙',
        customerId: customerBId,
        contactId: contactB.body.id,
        opportunityStage: '发现需求',
        opportunityAmount: 1000,
        expectedDealDate: '2026-10-01',
        chargerId: salesB.id,
        products: [{ productName: '咨询', quantity: 1, unitPrice: 1000 }],
      });
    expect(opportunityB.status, JSON.stringify(opportunityB.body)).toBe(201);
    const orderB = await request(app.getHttpServer())
      .post('/api/v1/sale-orders')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        orderTitle: '公开验收合同乙',
        customerId: customerBId,
        opportunityId: opportunityB.body.id,
        orderAmount: 1000,
        otherFee: 0,
        businessDate: '2026-09-15',
        orderBeginDate: '2026-09-15',
        chargerId: salesB.id,
        products: [
          {
            productName: '咨询',
            quantity: 1,
            unitPrice: 1000,
            contractUnitPrice: 1000,
            subtotalAmount: 1000,
          },
        ],
      });
    expect(orderB.status, JSON.stringify(orderB.body)).toBe(201);

    const contact = await request(app.getHttpServer())
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ contactName: '联系人甲', customerId: customerAId });
    expect(contact.status, JSON.stringify(contact.body)).toBe(201);

    const keep = await request(app.getHttpServer())
      .post('/api/v1/keep-records')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        customerId: customerAId,
        contactId: contact.body.id,
        keepRecordType: 'phone',
        keepRecordTime: '2026-09-15T02:00:00.000Z',
        keepRecordContent: '公开验收跟进',
        keepRecordStatus: '需求确认',
        chargerId: salesA.id,
        intentTemperature: 'HIGH',
        intentReasons: ['PAIN_POINT'],
        nextFollowUpAt: '2026-09-20',
      });
    expect(keep.status, JSON.stringify(keep.body)).toBe(201);
    expect(String(keep.body.nextFollowUpAt)).toMatch(/^2026-09-20/);
    expect(createdA.body.customerSource).toBe('小红书');

    const opportunity = await request(app.getHttpServer())
      .post('/api/v1/opportunities')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        opportunityName: '公开验收商机',
        customerId: customerAId,
        contactId: contact.body.id,
        opportunityStage: '发现需求',
        opportunityAmount: 12800,
        expectedDealDate: '2026-10-01',
        chargerId: salesA.id,
        products: [{ productName: '实施服务', quantity: 1, unitPrice: 12800 }],
      });
    expect(opportunity.status, JSON.stringify(opportunity.body)).toBe(201);

    const oppListA = await request(app.getHttpServer())
      .get('/api/v1/opportunities')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(oppListA.status).toBe(200);
    const oppIdsA = (oppListA.body.items as Array<{ id: string }>).map((row) => row.id);
    expect(oppIdsA).toContain(opportunity.body.id);
    expect(oppIdsA).not.toContain(opportunityB.body.id);

    const oppHidden = await request(app.getHttpServer())
      .get(`/api/v1/opportunities/${opportunity.body.id}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect([403, 404]).toContain(oppHidden.status);

    const order = await request(app.getHttpServer())
      .post('/api/v1/sale-orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        orderTitle: '公开验收合同',
        customerId: customerAId,
        opportunityId: opportunity.body.id,
        orderAmount: 12800,
        otherFee: 0,
        businessDate: '2026-09-15',
        orderBeginDate: '2026-09-15',
        chargerId: salesA.id,
        products: [
          {
            productName: '实施服务',
            quantity: 1,
            unitPrice: 12800,
            contractUnitPrice: 12800,
            subtotalAmount: 12800,
          },
        ],
      });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    const productId = order.body.products?.[0]?.id ?? order.body.orderProducts?.[0]?.id;
    expect(productId, JSON.stringify(order.body)).toBeTruthy();

    const orderListA = await request(app.getHttpServer())
      .get('/api/v1/sale-orders')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(orderListA.status).toBe(200);
    const orderIdsA = (orderListA.body.items as Array<{ id: string }>).map((row) => row.id);
    expect(orderIdsA).toContain(order.body.id);
    expect(orderIdsA).not.toContain(orderB.body.id);

    const orderHidden = await request(app.getHttpServer())
      .get(`/api/v1/sale-orders/${order.body.id}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect([403, 404]).toContain(orderHidden.status);

    const payment = await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        saleOrderId: order.body.id,
        customerId: customerAId,
        subject: '首期款',
        paymentAmount: 12800,
        paymentType: '银行转账',
        businessDate: '2026-09-15',
        bankName: '招商银行',
        chargerId: salesA.id,
        items: [
          {
            saleOrderProductId: productId,
            amount: 12800,
            paymentMode: 'direct',
          },
        ],
      });
    expect(payment.status, JSON.stringify(payment.body)).toBe(201);
    expect(payment.body.flowStatus).toBe('pending');
    expect(payment.body.items?.length ?? payment.body.paymentItems?.length).toBeGreaterThan(0);

    const instance = await request(app.getHttpServer())
      .get(`/api/v1/approvals/form/${APPROVAL_EVENT_TYPE.PAYMENT_APPROVE}/${payment.body.id}`)
      .set('Authorization', `Bearer ${tokenApprover}`);
    expect(instance.status, JSON.stringify(instance.body)).toBe(200);

    const rejected = await request(app.getHttpServer())
      .post(`/api/v1/approvals/${instance.body.id}/approve`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ action: 'approve', comment: '无权审批' });
    expect([401, 403, 404]).toContain(rejected.status);

    const approved = await request(app.getHttpServer())
      .post(`/api/v1/approvals/${instance.body.id}/approve`)
      .set('Authorization', `Bearer ${tokenApprover}`)
      .send({ action: 'approve', comment: '公开验收通过' });
    expect(approved.status, JSON.stringify(approved.body)).toBe(201);
    expect(approved.body.status === 'approved' || approved.body.success === true).toBe(true);

    const paymentAfter = await request(app.getHttpServer())
      .get(`/api/v1/payments/${payment.body.id}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(paymentAfter.body.flowStatus).toBe('approved');

    const ledgerCount = await prisma.financeLedger.count({
      where: { deletedAt: null },
    });
    expect(ledgerCount).toBeGreaterThan(0);

    const invoice = await request(app.getHttpServer())
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        saleOrderId: order.body.id,
        customerId: customerAId,
        subject: '实施服务费',
        invoiceAmount: 12800,
        invoiceType: '电子普票',
        invoiceDate: '2026-09-15',
      });
    expect(invoice.status, JSON.stringify(invoice.body)).toBe(201);

    const project = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        name: '公开验收项目',
        customerId: customerAId,
        opportunityId: opportunity.body.id,
        saleOrderId: order.body.id,
        ownerId: salesA.id,
      });
    expect(project.status, JSON.stringify(project.body)).toBe(201);

    const crossEntity = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        name: '跨主体项目',
        customerId: customerAId,
        opportunityId: opportunity.body.id,
        saleOrderId: orderB.body.id,
        ownerId: salesA.id,
      });
    expect(crossEntity.status, JSON.stringify(crossEntity.body)).toBe(400);

    const pat = await request(app.getHttpServer())
      .post('/api/v1/personal-access-tokens')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ employeeId: financeAdmin.id, name: 'agent-ops-bot' });
    expect(pat.status, JSON.stringify(pat.body)).toBe(201);
    const ledger = await prisma.financeLedger.findFirst({ where: { deletedAt: null } });
    expect(ledger).toBeTruthy();
    const stepUp = await request(app.getHttpServer())
      .post(`/api/v1/finance-ledger/${ledger!.id}/unlink-payment`)
      .set('Authorization', `Bearer ${pat.body.token}`)
      .send({ reason: 'PAT 不能绕过 step-up' });
    expect(stepUp.status).toBe(403);

    const effort = await request(app.getHttpServer())
      .post('/api/v1/effort-records')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        projectId: project.body.id,
        actualTime: 2,
        description: '公开验收工时',
        workDate: '2026-09-15',
        ownerId: salesA.id,
      });
    expect(effort.status, JSON.stringify(effort.body)).toBe(201);

    const forbidden = await request(app.getHttpServer())
      .delete(`/api/v1/employees/${admin.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(forbidden.status).toBe(403);
  });

  it('bootstrap 再跑幂等，并发不会产生双管理员', async () => {
    await prisma.cleanDatabase();
    await prisma.role.create({
      data: { code: 'ADMIN', name: '管理员', status: 'active' },
    });
    await prisma.role.create({
      data: { code: 'CRM_MANAGER', name: '客户成功', status: 'active' },
    });

    const dir = mkdtempSync(join(tmpdir(), 'azeroth-bootstrap-'));
    const adminFile = join(dir, 'admin.password');
    const approverFile = join(dir, 'approver.password');
    writeFileSync(adminFile, 'BootstrapPasswordA1!!');
    writeFileSync(approverFile, 'BootstrapPasswordB2!!');
    chmodSync(adminFile, 0o600);
    chmodSync(approverFile, 0o600);
    process.env.AZEROTH_BOOTSTRAP_PASSWORD_FILE = adminFile;
    process.env.AZEROTH_APPROVER_PASSWORD_FILE = approverFile;
    process.env.NODE_ENV = 'test';

    const adminRole = await prisma.role.findFirst({ where: { code: 'ADMIN' } });
    const orphan = await prisma.employee.create({
      data: {
        serialNumber: 'ADMIN_RETRY',
        name: 'Administrator',
        username: 'admin',
        password: await hash('OldPasswordNotUsed12', 4),
        canLogin: true,
        loginStatus: 'active',
      },
    });
    await seedEmployeeUsers(prisma);
    const retried = await prisma.employee.findMany({
      where: { username: 'admin', deletedAt: null },
    });
    expect(retried).toHaveLength(1);
    expect(retried[0]!.id).toBe(orphan.id);
    const bound = await prisma.userRole.findFirst({
      where: { employeeId: orphan.id, roleId: adminRole!.id },
    });
    expect(bound).toBeTruthy();
    expect(retried[0]!.password).toBe(orphan.password);

    await prisma.employee.deleteMany({ where: { username: { in: ['admin', 'approver'] } } });

    await seedEmployeeUsers(prisma);
    const first = await prisma.employee.findMany({
      where: { username: { in: ['admin', 'approver'] }, deletedAt: null },
      select: { id: true, username: true, password: true },
    });
    expect(first).toHaveLength(2);
    const firstAdmin = first.find((row) => row.username === 'admin')!;

    await seedEmployeeUsers(prisma);
    const second = await prisma.employee.findMany({
      where: { username: { in: ['admin', 'approver'] }, deletedAt: null },
    });
    expect(second).toHaveLength(2);
    expect(second.find((row) => row.username === 'admin')!.id).toBe(firstAdmin.id);
    expect(second.find((row) => row.username === 'admin')!.password).toBe(firstAdmin.password);

    await prisma.employee.deleteMany({ where: { username: { in: ['admin', 'approver'] } } });
    const concurrent = await Promise.allSettled([
      seedEmployeeUsers(prisma),
      seedEmployeeUsers(prisma),
    ]);
    expect(concurrent.some((item) => item.status === 'fulfilled')).toBe(true);
    const admins = await prisma.employee.findMany({
      where: { username: 'admin', deletedAt: null },
    });
    const approvers = await prisma.employee.findMany({
      where: { username: 'approver', deletedAt: null },
    });
    expect(admins).toHaveLength(1);
    expect(approvers).toHaveLength(1);
    expect(admins[0]!.id).not.toBe(approvers[0]!.id);
  });
});
