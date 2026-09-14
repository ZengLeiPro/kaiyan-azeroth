import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/prisma-mock.factory';
import { ApprovalGuardService } from '../approval-guard.service';

vi.mock('@ky-azeroth/shared/constants', async () => {
  const actual = await vi.importActual('@ky-azeroth/shared/constants');
  return {
    ...actual,
    APPROVAL_EVENT_REGISTRY: {
      sale_order_activate: {
        label: '销售订单激活',
        category: 'crm',
        categoryLabel: 'CRM',
        sortOrder: 1,
      },
      invoice_create: {
        label: '开票申请',
        category: 'finance',
        categoryLabel: '财务',
        sortOrder: 2,
      },
    },
  };
});

describe('ApprovalGuardService', () => {
  let service: ApprovalGuardService;
  let mockPrisma: MockPrismaService;

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    service = new ApprovalGuardService(asPrismaService(mockPrisma));
  });

  describe('isRequired', () => {
    it('有 active 流程时返回 true', async () => {
      mockPrisma.approvalFlow.findFirst.mockResolvedValue({ id: 'flow-1' });

      const result = await service.isRequired('sale_order_activate');

      expect(result).toBe(true);
      expect(mockPrisma.approvalFlow.findFirst).toHaveBeenCalledWith({
        where: { eventType: 'sale_order_activate', status: 'active' },
        select: { id: true },
      });
    });

    it('无 active 流程时返回 false', async () => {
      mockPrisma.approvalFlow.findFirst.mockResolvedValue(null);

      const result = await service.isRequired('sale_order_activate');

      expect(result).toBe(false);
    });
  });

  describe('getInitialStatus', () => {
    it('需要审批时返回 draft', async () => {
      mockPrisma.approvalFlow.findFirst.mockResolvedValue({ id: 'flow-1' });

      const result = await service.getInitialStatus('sale_order_activate');

      expect(result).toBe('draft');
    });

    it('不需要审批时返回 approved', async () => {
      mockPrisma.approvalFlow.findFirst.mockResolvedValue(null);

      const result = await service.getInitialStatus('sale_order_activate');

      expect(result).toBe('approved');
    });
  });

  describe('getAllModuleStatus', () => {
    it('返回所有模块状态（含 enabled/hasFlows/activeFlow）', async () => {
      mockPrisma.approvalFlow.findMany.mockResolvedValue([
        {
          id: 'flow-1',
          name: '销售订单审批流',
          eventType: 'sale_order_activate',
          version: 2,
          status: 'active',
        },
        {
          id: 'flow-2',
          name: '销售订单审批流 v1',
          eventType: 'sale_order_activate',
          version: 1,
          status: 'inactive',
        },
        {
          id: 'flow-3',
          name: '开票审批流',
          eventType: 'invoice_create',
          version: 1,
          status: 'inactive',
        },
      ]);

      const result = await service.getAllModuleStatus();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        eventType: 'sale_order_activate',
        label: '销售订单激活',
        category: 'crm',
        categoryLabel: 'CRM',
        sortOrder: 1,
        enabled: true,
        hasFlows: true,
        activeFlow: { id: 'flow-1', name: '销售订单审批流', version: 2 },
      });
      expect(result[1]).toEqual({
        eventType: 'invoice_create',
        label: '开票申请',
        category: 'finance',
        categoryLabel: '财务',
        sortOrder: 2,
        enabled: false,
        hasFlows: true,
        activeFlow: null,
      });
    });

    it('正确标记 enabled（has active flow）和 hasFlows', async () => {
      mockPrisma.approvalFlow.findMany.mockResolvedValue([
        {
          id: 'flow-1',
          name: '销售订单审批流',
          eventType: 'sale_order_activate',
          version: 1,
          status: 'active',
        },
      ]);

      const result = await service.getAllModuleStatus();

      // sale_order_activate: 有 active 流程
      const saleOrder = result.find((r) => r.eventType === 'sale_order_activate');
      expect(saleOrder?.enabled).toBe(true);
      expect(saleOrder?.hasFlows).toBe(true);

      // invoice_create: 无流程
      const invoice = result.find((r) => r.eventType === 'invoice_create');
      expect(invoice?.enabled).toBe(false);
      expect(invoice?.hasFlows).toBe(false);
    });

    it('按 sortOrder 排序', async () => {
      mockPrisma.approvalFlow.findMany.mockResolvedValue([]);

      const result = await service.getAllModuleStatus();

      expect(result[0]!.eventType).toBe('sale_order_activate'); // sortOrder: 1
      expect(result[1]!.eventType).toBe('invoice_create'); // sortOrder: 2
    });

    it('无流程时 enabled=false, hasFlows=false', async () => {
      mockPrisma.approvalFlow.findMany.mockResolvedValue([]);

      const result = await service.getAllModuleStatus();

      for (const module of result) {
        expect(module.enabled).toBe(false);
        expect(module.hasFlows).toBe(false);
        expect(module.activeFlow).toBeNull();
      }
    });
  });
});
