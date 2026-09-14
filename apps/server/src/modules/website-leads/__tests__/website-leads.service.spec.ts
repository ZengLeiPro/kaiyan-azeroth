import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHmac } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/prisma-mock.factory';
import {
  asSerialNumberService,
  createMockSerialNumberService,
  type MockSerialNumberService,
} from '../../../test/serial-number-mock.factory';
import { WebsiteLeadIngestDto } from '../dto/website-lead-ingest.dto';
import { WebsiteLeadsController } from '../website-leads.controller';
import { WebsiteLeadsService } from '../website-leads.service';

const input = {
  event: 'lead_submit' as const,
  site: 'example.com',
  phone: '13800138000',
  path: '/ai-employee',
  placement: 'home_lead_form',
  channel: 'ai_employee',
  receivedAt: '2026-07-04T11:30:00.000Z',
  region: '福建省',
  city: '厦门市',
};

const trialSignupInput = {
  sourceId: 'ts_user-abc123',
  event: 'trial_signup' as const,
  site: 'leads.example.com',
  phone: '13800138000',
  channel: 'ai_employee',
  name: '张总',
  position: '老板/总经理',
  company: '测试制造有限公司',
  scenario: 'boss-competitor-daily',
  tenantId: 'trial-ab12cd34',
  receivedAt: '2026-07-07T14:45:00.000Z',
};

describe('WebsiteLeadsService', () => {
  let service: WebsiteLeadsService;
  let mockPrisma: MockPrismaService;
  let mockSerialNumber: MockSerialNumberService;
  let configValues: Record<string, string | undefined>;

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    mockSerialNumber = createMockSerialNumberService('CUS');
    configValues = {
      WEBSITE_LEAD_WEBHOOK_SECRET: 'website-lead-secret-for-test',
      WEBSITE_LEAD_DEFAULT_OWNER_EMPLOYEE_ID: 'emp-approver',
    };
    const config = {
      get: vi.fn((key: string) => configValues[key]),
    };

    service = new WebsiteLeadsService(
      asPrismaService(mockPrisma),
      config as unknown as ConfigService,
      asSerialNumberService(mockSerialNumber)
    );
  });

  it('校验 collector HMAC 签名', () => {
    const timestamp = String(Date.now());
    const body = '{"event":"lead_submit","phone":"13800138000","site":"example.com"}';
    const signature = createHmac('sha256', configValues.WEBSITE_LEAD_WEBHOOK_SECRET!)
      .update(`${timestamp}.${body}`)
      .digest('hex');

    expect(() =>
      service.verifySignature(
        { event: 'lead_submit', phone: '13800138000', site: 'example.com' },
        timestamp,
        `sha256=${signature}`
      )
    ).not.toThrow();
  });

  it('新手机号进入公海客户、联系人和官网新线索待办', async () => {
    mockPrisma.contact.findFirst.mockResolvedValue(null);
    mockPrisma.employee.findFirst.mockResolvedValue({ id: 'emp-approver', name: '林审批' });
    mockPrisma.customer.create.mockResolvedValue({
      id: 'cust-1',
      customerName: '官网留资客户 8000',
      chargerId: null,
    });
    mockPrisma.salesActionItem.findFirst.mockResolvedValue(null);
    mockPrisma.salesActionItem.create.mockResolvedValue({ id: 'action-1' });

    const result = await service.ingest(input);

    expect(mockPrisma.websiteLeadImport.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        phone: '13800138000',
        status: 'processing',
        sourceSite: 'example.com',
      }),
    });
    expect(mockPrisma.customer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customerName: '官网留资客户 8000',
        customerSource: '官网留资',
        chargerId: null,
        creatorEmployeeId: 'emp-approver',
      }),
      select: { id: true, customerName: true, chargerId: true },
    });
    expect(mockPrisma.contact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customerId: 'cust-1',
        mobile: '13800138000',
      }),
    });
    expect(mockPrisma.salesActionItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        employeeId: 'emp-approver',
        category: 'WEBSITE_LEAD_NEW',
        refType: 'Customer',
        refId: 'cust-1',
        dedupKey: 'website_lead:13800138000',
      }),
      select: { id: true },
    });
    expect(result).toEqual({
      status: 'imported',
      customerId: 'cust-1',
      actionItemId: 'action-1',
      matchedExistingCustomer: false,
    });
  });

  it.each([
    [
      'HTTPS://[2001:db8::1]:8443/source?q=a%20b#campaign',
      'https://[2001:db8::1]:8443/source?q=a%20b#campaign',
    ],
    ['https://example.com/%FF', 'https://example.com/%FF'],
    ['https://example.com/%D6%D0%CE%C4', 'https://example.com/%D6%D0%CE%C4'],
  ])('官网合法 referrer %j 经统一 guard 规范化后生成 doc evidence', async (referrer, url) => {
    mockPrisma.contact.findFirst.mockResolvedValue(null);
    mockPrisma.employee.findFirst.mockResolvedValue({ id: 'emp-approver', name: '林审批' });
    mockPrisma.customer.create.mockResolvedValue({
      id: 'cust-1',
      customerName: '官网留资客户 8000',
      chargerId: null,
    });
    mockPrisma.salesActionItem.findFirst.mockResolvedValue(null);
    mockPrisma.salesActionItem.create.mockResolvedValue({ id: 'action-1' });

    await service.ingest({ ...input, referrer });

    expect(mockPrisma.salesActionItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        evidence: expect.arrayContaining([
          {
            type: 'doc',
            title: '访问来源页',
            url,
          },
        ]),
      }),
      select: { id: true },
    });
  });

  it.each([
    'https://user:password@example.com/source',
    'https://example.com/path\\source',
    'https://example.com/%255Csource',
    'https://example.com/%ZZ',
    'https://example.com/%25ZZ',
    'https://example.com/%00',
    'https://example.com/%250Aevil',
    'https://example.com/%E2%80%AEhidden',
    'https://example.com/%25E2%2580%25AEhidden',
    'https://例子.测试/source',
    ' https://example.com/source',
    'https://example.com/source ',
  ])('官网非法 referrer %j fail-closed，不生成 doc evidence', async (referrer) => {
    mockPrisma.contact.findFirst.mockResolvedValue(null);
    mockPrisma.employee.findFirst.mockResolvedValue({ id: 'emp-approver', name: '林审批' });
    mockPrisma.customer.create.mockResolvedValue({
      id: 'cust-1',
      customerName: '官网留资客户 8000',
      chargerId: null,
    });
    mockPrisma.salesActionItem.findFirst.mockResolvedValue(null);
    mockPrisma.salesActionItem.create.mockResolvedValue({ id: 'action-1' });

    await service.ingest({ ...input, referrer });

    const createCall = mockPrisma.salesActionItem.create.mock.calls[0]?.[0] as
      | { data?: { evidence?: Array<{ type?: unknown }> } }
      | undefined;
    expect(createCall?.data?.evidence?.map((item) => item.type)).toEqual(['website']);
  });

  it.each([' https://example.com/source', 'https://example.com/source '])(
    'DTO→controller→service 保留 referrer 首尾空格 %j 给统一 guard，并仅 trim 文本副本',
    async (referrer) => {
      mockPrisma.contact.findFirst.mockResolvedValue(null);
      mockPrisma.employee.findFirst.mockResolvedValue({ id: 'emp-approver', name: '林审批' });
      mockPrisma.customer.create.mockResolvedValue({
        id: 'cust-1',
        customerName: '官网留资客户 8000',
        chargerId: null,
      });
      mockPrisma.salesActionItem.findFirst.mockResolvedValue(null);
      mockPrisma.salesActionItem.create.mockResolvedValue({ id: 'action-1' });

      const body = WebsiteLeadIngestDto.schema.parse({
        event: 'lead_submit',
        site: 'example.com',
        phone: '13800138000',
        referrer,
      });
      const timestamp = String(Date.now());
      const signedBody = JSON.stringify({
        event: body.event,
        phone: body.phone,
        referrer: body.referrer,
        site: body.site,
      });
      const signature = createHmac('sha256', configValues.WEBSITE_LEAD_WEBHOOK_SECRET!)
        .update(`${timestamp}.${signedBody}`)
        .digest('hex');

      await new WebsiteLeadsController(service).ingest(body, timestamp, `sha256=${signature}`);

      expect(body.referrer).toBe(referrer);
      const createCall = mockPrisma.salesActionItem.create.mock.calls[0]?.[0] as
        | {
            data?: {
              evidence?: Array<{ type?: unknown; referrer?: unknown }>;
            };
          }
        | undefined;
      expect(createCall?.data?.evidence).toEqual([
        expect.objectContaining({
          type: 'website',
          referrer: 'https://example.com/source',
        }),
      ]);
    }
  );

  it('手机号命中已有联系人时复用老客户，并把待办发给现负责人与林审批', async () => {
    mockPrisma.contact.findFirst.mockResolvedValue({
      id: 'contact-1',
      customer: { id: 'cust-old', customerName: '老客户', chargerId: 'emp-sales' },
    });
    mockPrisma.employee.findFirst
      .mockResolvedValueOnce({ id: 'emp-approver', name: '林审批' })
      .mockResolvedValueOnce({ id: 'emp-sales', name: '销售A' });
    mockPrisma.salesActionItem.findFirst.mockResolvedValue(null);
    mockPrisma.salesActionItem.create
      .mockResolvedValueOnce({ id: 'action-2' })
      .mockResolvedValueOnce({ id: 'action-approver' });

    const result = await service.ingest(input);

    expect(mockPrisma.customer.create).not.toHaveBeenCalled();
    expect(mockPrisma.contact.create).not.toHaveBeenCalled();
    expect(mockPrisma.salesActionItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        employeeId: 'emp-sales',
        refId: 'cust-old',
        dedupKey: 'website_lead:13800138000',
      }),
      select: { id: true },
    });
    expect(mockPrisma.salesActionItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        employeeId: 'emp-approver',
        refId: 'cust-old',
        dedupKey: 'website_lead:13800138000',
      }),
      select: { id: true },
    });
    expect(mockPrisma.salesActionItem.create).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      status: 'imported',
      customerId: 'cust-old',
      actionItemId: 'action-2',
      matchedExistingCustomer: true,
    });
  });

  it('按配置的默认接单人 UUID 建档，不按姓名查找', async () => {
    configValues.WEBSITE_LEAD_DEFAULT_OWNER_EMPLOYEE_ID = 'emp-owner';
    mockPrisma.contact.findFirst.mockResolvedValue(null);
    mockPrisma.employee.findFirst.mockResolvedValue({ id: 'emp-owner', name: '接单人' });
    mockPrisma.customer.create.mockResolvedValue({
      id: 'cust-1',
      customerName: '官网留资客户 8000',
      chargerId: null,
    });
    mockPrisma.salesActionItem.findFirst.mockResolvedValue(null);
    mockPrisma.salesActionItem.create.mockResolvedValue({ id: 'action-owner' });

    const result = await service.ingest(input);

    expect(mockPrisma.employee.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'emp-owner' }),
      })
    );
    expect(mockPrisma.customer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        creatorEmployeeId: 'emp-owner',
        updaterEmployeeId: 'emp-owner',
      }),
      select: { id: true, customerName: true, chargerId: true },
    });
    expect(result.actionItemId).toBe('action-owner');
  });

  it('trial_signup 新手机号：真实公司名建档、来源=试用注册、联系人带称呼岗位、陪跑待办', async () => {
    mockPrisma.contact.findFirst.mockResolvedValue(null);
    mockPrisma.employee.findFirst.mockResolvedValue({ id: 'emp-approver', name: '林审批' });
    mockPrisma.customer.create.mockResolvedValue({
      id: 'cust-trial',
      customerName: '测试制造有限公司',
      chargerId: null,
    });
    mockPrisma.salesActionItem.findFirst.mockResolvedValue(null);
    mockPrisma.salesActionItem.create.mockResolvedValue({ id: 'action-trial' });

    const result = await service.ingest(trialSignupInput);

    expect(mockPrisma.websiteLeadImport.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ sourceId: 'ts_user-abc123', sourceSite: 'leads.example.com' }),
    });
    expect(mockPrisma.customer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customerName: '测试制造有限公司',
        customerSource: '试用注册',
      }),
      select: { id: true, customerName: true, chargerId: true },
    });
    expect(mockPrisma.contact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contactName: '张总',
        position: '老板/总经理',
        mobile: '13800138000',
      }),
    });
    expect(mockPrisma.salesActionItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: '试用已注册 138****8000',
        dedupKey: 'website_lead:13800138000',
        suggestedAction: expect.stringContaining('D0 陪跑'),
        reason: expect.stringContaining('boss-competitor-daily'),
      }),
      select: { id: true },
    });
    expect(result.status).toBe('imported');
  });

  it('trial_signup 命中已留资客户：不重建客户，同 dedupKey 待办升级为陪跑文案（合流）', async () => {
    mockPrisma.contact.findFirst.mockResolvedValue({
      id: 'contact-1',
      customer: { id: 'cust-lead', customerName: '官网留资客户 8000', chargerId: null },
    });
    mockPrisma.employee.findFirst.mockResolvedValue({ id: 'emp-approver', name: '林审批' });
    // 留资时已生成的 pending 待办 → trial_signup 走 merge 升级
    mockPrisma.salesActionItem.findFirst.mockResolvedValue({ id: 'action-lead' });
    mockPrisma.salesActionItem.update.mockResolvedValue({ id: 'action-lead' });

    const result = await service.ingest(trialSignupInput);

    expect(mockPrisma.customer.create).not.toHaveBeenCalled();
    expect(mockPrisma.contact.create).not.toHaveBeenCalled();
    expect(mockPrisma.salesActionItem.update).toHaveBeenCalledWith({
      where: { id: 'action-lead' },
      data: expect.objectContaining({
        title: '试用已注册 138****8000',
        dedupKey: 'website_lead:13800138000',
        remindCount: { increment: 1 },
      }),
      select: { id: true },
    });
    expect(result).toEqual({
      status: 'imported',
      customerId: 'cust-lead',
      actionItemId: 'action-lead',
      matchedExistingCustomer: true,
    });
  });

  it('同手机号并发撞到待办唯一约束时合并到已存在待办', async () => {
    mockPrisma.contact.findFirst.mockResolvedValue(null);
    mockPrisma.employee.findFirst.mockResolvedValue({ id: 'emp-approver', name: '林审批' });
    mockPrisma.customer.create.mockResolvedValue({
      id: 'cust-1',
      customerName: '官网留资客户 8000',
      chargerId: null,
    });
    mockPrisma.salesActionItem.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'action-raced' });
    mockPrisma.salesActionItem.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique action item', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['employeeId', 'dedupKey'] },
      })
    );
    mockPrisma.salesActionItem.update.mockResolvedValue({ id: 'action-raced' });

    const result = await service.ingest(input);

    expect(mockPrisma.salesActionItem.update).toHaveBeenCalledWith({
      where: { id: 'action-raced' },
      data: expect.objectContaining({
        dedupKey: 'website_lead:13800138000',
        remindCount: { increment: 1 },
      }),
      select: { id: true },
    });
    expect(result.actionItemId).toBe('action-raced');
  });
});
