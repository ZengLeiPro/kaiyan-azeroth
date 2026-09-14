import { Decimal } from '@prisma/client/runtime/library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../../test/prisma-mock.factory';
import { OrderProductReceivableService } from '../order-product-receivable.service';

/**
 * OrderProductReceivableService 单测（绑定方案 v2.2 Phase 3）
 *
 * 覆盖：
 *  1. recalculateForOrderProduct：OP 不存在/软删 → 返回 0
 *  2. recalculateForOrderProduct：计算并写回缓存 → 返回 {old, new, delta}
 *  3. recalculateBatch：去重 + filter null → 调用 N 次
 *  4. recalculateForPayment：按 paymentId 查 PaymentItem → batch
 *  5. auditFullTable：扫所有 OP，差额 < 0.01 视为同步
 *  6. auditFullTable：差额 >= 0.01 进 outOfSync
 *  7. reconcile dryRun=true：不写库，只返回失同步
 *  8. reconcile dryRun=false：单事务修复失同步行
 *  9. reconcile orderProductIds 限定范围
 */
describe('OrderProductReceivableService (v2.2 Phase 3)', () => {
  let service: OrderProductReceivableService;
  let mockPrisma: MockPrismaService;

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    service = new OrderProductReceivableService(asPrismaService(mockPrisma));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('recalculateForOrderProduct', () => {
    it('1a. OP 不存在 → 返回 0/0/0，不写库', async () => {
      mockPrisma.orderProduct.findUnique.mockResolvedValue(null);
      const result = await service.recalculateForOrderProduct(
        asPrismaService(mockPrisma),
        'op-nonexistent'
      );
      expect(result.old.toString()).toBe('0');
      expect(result.new.toString()).toBe('0');
      expect(mockPrisma.orderProduct.update).not.toHaveBeenCalled();
    });

    it('1b. OP 已软删 → 返回 0/0/0，不写库', async () => {
      mockPrisma.orderProduct.findUnique.mockResolvedValue({
        id: 'op-1',
        totalReceivedAmount: new Decimal('500'),
        deletedAt: new Date(),
      });
      const result = await service.recalculateForOrderProduct(asPrismaService(mockPrisma), 'op-1');
      expect(result.delta.toString()).toBe('0');
      expect(mockPrisma.orderProduct.update).not.toHaveBeenCalled();
    });

    it('2. 计算并写回，返回 {old, new, delta}', async () => {
      mockPrisma.orderProduct.findUnique.mockResolvedValue({
        id: 'op-1',
        totalReceivedAmount: new Decimal('500.00'),
        deletedAt: null,
      });
      mockPrisma.paymentItem.aggregate.mockResolvedValue({
        _sum: { amount: new Decimal('750.00') },
      });

      const result = await service.recalculateForOrderProduct(asPrismaService(mockPrisma), 'op-1');
      expect(result.old.toString()).toBe('500');
      expect(result.new.toString()).toBe('750');
      expect(result.delta.toString()).toBe('250');
      expect(mockPrisma.orderProduct.update).toHaveBeenCalledWith({
        where: { id: 'op-1' },
        data: { totalReceivedAmount: new Decimal('750.00') },
      });
      expect(mockPrisma.paymentItem.aggregate).toHaveBeenCalledWith({
        where: {
          saleOrderProductId: 'op-1',
          deletedAt: null,
          payment: {
            flowStatus: 'approved',
            legacyAdjustment: false,
            deletedAt: null,
          },
        },
        _sum: { amount: true },
      });
    });

    it('2b. _sum.amount=null → 用 0 兜底', async () => {
      mockPrisma.orderProduct.findUnique.mockResolvedValue({
        id: 'op-1',
        totalReceivedAmount: new Decimal('500'),
        deletedAt: null,
      });
      mockPrisma.paymentItem.aggregate.mockResolvedValue({
        _sum: { amount: null },
      });
      const result = await service.recalculateForOrderProduct(asPrismaService(mockPrisma), 'op-1');
      expect(result.new.toString()).toBe('0');
      expect(result.delta.toString()).toBe('-500');
    });
  });

  describe('recalculateBatch', () => {
    it('3. 去重 + 过滤 null/undefined → 仅调用唯一 ids', async () => {
      mockPrisma.orderProduct.findUnique.mockResolvedValue({
        id: 'op-1',
        totalReceivedAmount: new Decimal('0'),
        deletedAt: null,
      });
      mockPrisma.paymentItem.aggregate.mockResolvedValue({
        _sum: { amount: new Decimal('100') },
      });
      const result = await service.recalculateBatch(asPrismaService(mockPrisma), [
        'op-1',
        'op-1', // 重复
        null,
        undefined,
        'op-2',
      ]);
      expect(result.updated).toBe(2); // op-1 + op-2 都有 delta
      expect(mockPrisma.orderProduct.findUnique).toHaveBeenCalledTimes(2);
    });
  });

  describe('recalculateForPayment', () => {
    it('4. 按 paymentId 查 PaymentItem → 拿 saleOrderProductId → batch', async () => {
      mockPrisma.paymentItem.findMany.mockResolvedValue([
        { saleOrderProductId: 'op-1' },
        { saleOrderProductId: 'op-2' },
        { saleOrderProductId: 'op-1' }, // 重复
        { saleOrderProductId: null }, // 历史回填期可能为 null
      ]);
      mockPrisma.orderProduct.findUnique.mockResolvedValue({
        id: 'op-x',
        totalReceivedAmount: new Decimal('0'),
        deletedAt: null,
      });
      mockPrisma.paymentItem.aggregate.mockResolvedValue({
        _sum: { amount: new Decimal('200') },
      });

      const result = await service.recalculateForPayment(asPrismaService(mockPrisma), 'pay-1');
      expect(result.updated).toBe(2); // op-1 + op-2 都有 delta
      // null 被过滤；重复去重 → 2 个 unique
      expect(mockPrisma.orderProduct.findUnique).toHaveBeenCalledTimes(2);
    });
  });

  describe('auditFullTable', () => {
    it('5. 差额 < 0.01 视为同步，不进 outOfSync', async () => {
      mockPrisma.orderProduct.findMany.mockResolvedValue([
        { id: 'op-1', totalReceivedAmount: new Decimal('100.00') },
        { id: 'op-2', totalReceivedAmount: new Decimal('200.001') },
      ]);
      mockPrisma.paymentItem.aggregate
        .mockResolvedValueOnce({ _sum: { amount: new Decimal('100.00') } })
        .mockResolvedValueOnce({ _sum: { amount: new Decimal('200.00') } }); // 差 0.001

      const result = await service.auditFullTable();
      expect(result.checked).toBe(2);
      expect(result.outOfSync).toHaveLength(0);
    });

    it('6. 差额 >= 0.01 进 outOfSync', async () => {
      mockPrisma.orderProduct.findMany.mockResolvedValue([
        { id: 'op-1', totalReceivedAmount: new Decimal('500.00') },
      ]);
      mockPrisma.paymentItem.aggregate.mockResolvedValue({
        _sum: { amount: new Decimal('510.00') },
      });

      const result = await service.auditFullTable();
      expect(result.outOfSync).toHaveLength(1);
      expect(result.outOfSync[0]).toEqual({
        orderProductId: 'op-1',
        cached: '500.00',
        computed: '510.00',
        delta: '10.00',
      });
    });
  });

  describe('reconcile', () => {
    it('7. dryRun=true → 不写库，只返回失同步', async () => {
      mockPrisma.orderProduct.findMany.mockResolvedValue([
        { id: 'op-1', totalReceivedAmount: new Decimal('100.00') },
      ]);
      mockPrisma.paymentItem.aggregate.mockResolvedValue({
        _sum: { amount: new Decimal('150.00') },
      });

      const result = await service.reconcile({ dryRun: true });
      expect(result.dryRun).toBe(true);
      expect(result.fixed).toBe(0);
      expect(result.outOfSync).toHaveLength(1);
      expect(mockPrisma.orderProduct.update).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('8. dryRun=false → 同事务修复失同步行', async () => {
      mockPrisma.orderProduct.findMany.mockResolvedValue([
        { id: 'op-1', totalReceivedAmount: new Decimal('100.00') },
        { id: 'op-2', totalReceivedAmount: new Decimal('200.00') }, // 同步
      ]);
      mockPrisma.paymentItem.aggregate
        .mockResolvedValueOnce({ _sum: { amount: new Decimal('150.00') } })
        .mockResolvedValueOnce({ _sum: { amount: new Decimal('200.00') } });

      const result = await service.reconcile({ dryRun: false });
      expect(result.dryRun).toBe(false);
      expect(result.fixed).toBe(1);
      expect(result.outOfSync).toHaveLength(1);
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('9. orderProductIds 限定范围 → 只查指定 ids', async () => {
      mockPrisma.orderProduct.findMany.mockResolvedValue([
        { id: 'op-1', totalReceivedAmount: new Decimal('100.00') },
      ]);
      mockPrisma.paymentItem.aggregate.mockResolvedValue({
        _sum: { amount: new Decimal('100.00') },
      });

      await service.reconcile({ orderProductIds: ['op-1'], dryRun: true });
      const findManyArg = mockPrisma.orderProduct.findMany.mock.calls[0]?.[0] as {
        where: { id: { in: string[] }; deletedAt: null };
      };
      expect(findManyArg.where.id).toEqual({ in: ['op-1'] });
    });
  });
});
