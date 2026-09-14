import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FinanceLedgerSyncService } from '../finance-ledger-sync.service';

type TxMock = Prisma.TransactionClient;
const asTx = (mock: unknown) => mock as unknown as TxMock;

/**
 * FinanceLedgerSyncService 单测（绑定方案 v2.2）
 *
 * 关键边界（相对 v2.1）：
 *  - 输入仍是 paymentId；内部按 paymentItems 遍历派生 N 条 ledger
 *  - paymentMode ∈ {dingtalk_collect, pass_through_cost} → 跳过派生
 *  - paymentMode ∈ {direct, pass_through} → 派生 ledger
 *  - 1:1 主轴：finance_ledger.paymentItemId @unique
 *  - revokeFromPayment 改为 1:N 软删（逐条 update）
 *
 * 覆盖 18 case（替代 v2.1 的 14 case，增加 PaymentItem 与 mode 维度）
 */

const SUBJECT_ROW = { id: 'subj-uncategorized-id' };

interface BuildTxOpts {
  payment?: Record<string, unknown> | null;
  existingLedgerByItem?: Record<string, Record<string, unknown> | null>;
  revokeLedgers?: Array<Record<string, unknown>>;
  /** v2.2 PR-C 懒迁移：bankName→financeAccount code 反查 DB 时返回的账户行（按 code 索引） */
  financeAccountsByCode?: Record<string, { id: string } | null>;
}

function buildTx(opts: BuildTxOpts = {}) {
  const tx = {
    payment: {
      findUnique: vi.fn().mockResolvedValue(opts.payment ?? null),
      update: vi.fn().mockResolvedValue({ id: 'payment-x' }),
    },
    financeLedger: {
      findUnique: vi.fn().mockImplementation((args: { where: { paymentItemId: string } }) => {
        const itemId = args.where.paymentItemId;
        return Promise.resolve(opts.existingLedgerByItem?.[itemId] ?? null);
      }),
      findMany: vi.fn().mockResolvedValue(opts.revokeLedgers ?? []),
      create: vi.fn().mockResolvedValue({ id: 'ledger-new' }),
      update: vi.fn().mockResolvedValue({ id: 'ledger-updated' }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    financeSubject: {
      findUnique: vi.fn().mockResolvedValue(SUBJECT_ROW),
    },
    financeAccount: {
      findFirst: vi
        .fn()
        .mockImplementation((args: { where: { code: string; deletedAt: null } }) => {
          const code = args.where.code;
          return Promise.resolve(opts.financeAccountsByCode?.[code] ?? null);
        }),
    },
  };
  return tx;
}

function buildPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payment-x',
    serialNumber: 'PAY-X',
    saleOrderId: 'order-x',
    paymentAmount: new Decimal('100.00'),
    direction: 'IN',
    flowStatus: 'approved',
    businessDate: new Date('2026-06-20T00:00:00.000Z'),
    financeAccountId: 'acc-cmb',
    /** v2.2 PR-C：懒迁移用的 bankName 字段（select 已包含） */
    bankName: null,
    chargerId: 'emp-x',
    creatorEmployeeId: 'emp-x',
    updaterEmployeeId: 'emp-x',
    deletedAt: null,
    saleOrder: { id: 'order-x', serialNumber: 'SO-X', orderTitle: '订单标题' },
    paymentItems: [],
    ...overrides,
  };
}

function buildItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    itemSeq: 1,
    productName: '钉钉专业版',
    amount: new Decimal('100.00'),
    financeSubjectId: 'subj-resale',
    paymentMode: 'direct',
    ...overrides,
  };
}

describe('FinanceLedgerSyncService (v2.2)', () => {
  let service: FinanceLedgerSyncService;

  function createWithFlag(enabled: boolean) {
    const config = {
      get: vi.fn().mockReturnValue(enabled ? 'true' : 'false'),
    } as unknown as ConfigService;
    return new FinanceLedgerSyncService(config);
  }

  beforeEach(() => {
    service = createWithFlag(true);
  });

  describe('FEATURE_FLAG=false', () => {
    it('1. syncFromPayment 静默 no-op', async () => {
      const svc = createWithFlag(false);
      const tx = buildTx();
      await svc.syncFromPayment(asTx(tx), 'payment-x');
      expect(tx.payment.findUnique).not.toHaveBeenCalled();
    });

    it('1b. 功能开关关闭时仍清理既有派生流水', async () => {
      const svc = createWithFlag(false);
      const tx = buildTx();
      await svc.revokeFromPayment(asTx(tx), 'payment-x', 'reason');
      expect(tx.financeLedger.findMany).toHaveBeenCalledWith({
        where: { paymentId: 'payment-x', source: 'crm_payment', deletedAt: null },
        select: { id: true, remark: true },
      });
    });
  });

  describe('syncFromPayment 前置校验', () => {
    it('2. payment 不存在 → 抛 BadRequestException', async () => {
      const tx = buildTx({ payment: null });
      await expect(service.syncFromPayment(asTx(tx), 'payment-x')).rejects.toThrow(
        BadRequestException
      );
    });

    it('3. payment 已软删 → warn + skip', async () => {
      const tx = buildTx({ payment: buildPayment({ deletedAt: new Date() }) });
      await service.syncFromPayment(asTx(tx), 'payment-x');
      expect(tx.financeLedger.create).not.toHaveBeenCalled();
    });

    it('4. payment 未 approved → warn + skip', async () => {
      const tx = buildTx({ payment: buildPayment({ flowStatus: 'draft' }) });
      await service.syncFromPayment(asTx(tx), 'payment-x');
      expect(tx.financeLedger.create).not.toHaveBeenCalled();
    });

    it('5. payment 缺 financeAccountId 且 bankName=null → 抛错', async () => {
      const tx = buildTx({ payment: buildPayment({ financeAccountId: null, bankName: null }) });
      await expect(service.syncFromPayment(asTx(tx), 'payment-x')).rejects.toThrow(
        /未指定收款账户/
      );
    });

    it('5b. PR-C 懒迁移：financeAccountId=null + bankName=招商银行 + DB 命中 → 自动补 + 继续派生', async () => {
      const tx = buildTx({
        payment: buildPayment({
          financeAccountId: null,
          bankName: '招商银行',
          paymentItems: [buildItem()],
        }),
        financeAccountsByCode: { cmb: { id: 'acc-cmb-from-lazy' } },
      });
      await service.syncFromPayment(asTx(tx), 'payment-x');
      // 懒迁移：按 code='cmb' 查到 acc-cmb-from-lazy + payment.update 把 financeAccountId 写回去
      expect(tx.financeAccount.findFirst).toHaveBeenCalledWith({
        where: { code: 'cmb', deletedAt: null },
        select: { id: true },
      });
      expect(tx.payment.update).toHaveBeenCalledWith({
        where: { id: 'payment-x' },
        data: { financeAccountId: 'acc-cmb-from-lazy' },
      });
      // 派生 ledger 用懒迁移补上的 accountId
      const createArg = tx.financeLedger.create.mock.calls[0]?.[0] as {
        data: { accountId: string };
      };
      expect(createArg.data.accountId).toBe('acc-cmb-from-lazy');
    });

    it('5c. PR-C 懒迁移：bankName 不在映射表 → 不补 + 仍抛错', async () => {
      const tx = buildTx({
        payment: buildPayment({ financeAccountId: null, bankName: '某自定义银行' }),
      });
      await expect(service.syncFromPayment(asTx(tx), 'payment-x')).rejects.toThrow(
        /未指定收款账户/
      );
      // 不在映射表，根本不该查 DB
      expect(tx.financeAccount.findFirst).not.toHaveBeenCalled();
      expect(tx.payment.update).not.toHaveBeenCalled();
    });

    it('5d. PR-C 懒迁移：bankName 在映射但 DB 找不到 finance_account → 仍抛错', async () => {
      const tx = buildTx({
        payment: buildPayment({ financeAccountId: null, bankName: '招商银行' }),
        financeAccountsByCode: { cmb: null },
      });
      await expect(service.syncFromPayment(asTx(tx), 'payment-x')).rejects.toThrow(
        /未指定收款账户/
      );
      expect(tx.financeAccount.findFirst).toHaveBeenCalled();
      expect(tx.payment.update).not.toHaveBeenCalled();
    });

    it('6. payment 缺 businessDate → 抛错', async () => {
      const tx = buildTx({ payment: buildPayment({ businessDate: null }) });
      await expect(service.syncFromPayment(asTx(tx), 'payment-x')).rejects.toThrow(/缺少业务日期/);
    });

    it('7. payment 无 PaymentItem → warn + skip（历史回填窗口期）', async () => {
      const tx = buildTx({ payment: buildPayment({ paymentItems: [] }) });
      await service.syncFromPayment(asTx(tx), 'payment-x');
      expect(tx.financeLedger.create).not.toHaveBeenCalled();
      expect(tx.financeLedger.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('syncFromPayment paymentMode 过滤', () => {
    it('8. mode=dingtalk_collect → 跳过派生', async () => {
      const tx = buildTx({
        payment: buildPayment({
          paymentItems: [buildItem({ paymentMode: 'dingtalk_collect' })],
        }),
      });
      await service.syncFromPayment(asTx(tx), 'payment-x');
      expect(tx.financeLedger.create).not.toHaveBeenCalled();
      // orphan 清理仍调用（liveItemIds=[] 时清理所有派生）
      expect(tx.financeLedger.updateMany).toHaveBeenCalledTimes(1);
    });

    it('9. mode=pass_through_cost → 跳过派生', async () => {
      const tx = buildTx({
        payment: buildPayment({
          paymentItems: [buildItem({ paymentMode: 'pass_through_cost' })],
        }),
      });
      await service.syncFromPayment(asTx(tx), 'payment-x');
      expect(tx.financeLedger.create).not.toHaveBeenCalled();
    });

    it('10. PaymentItem.amount<=0 → 跳过派生', async () => {
      const tx = buildTx({
        payment: buildPayment({ paymentItems: [buildItem({ amount: new Decimal(0) })] }),
      });
      await service.syncFromPayment(asTx(tx), 'payment-x');
      expect(tx.financeLedger.create).not.toHaveBeenCalled();
    });
  });

  describe('syncFromPayment 派生主路径', () => {
    it('11. 单 direct item → 新建 ledger，subjectId 来自 item', async () => {
      const item = buildItem({ id: 'item-1', financeSubjectId: 'subj-resale' });
      const tx = buildTx({ payment: buildPayment({ paymentItems: [item] }) });
      await service.syncFromPayment(asTx(tx), 'payment-x');
      expect(tx.financeLedger.create).toHaveBeenCalledTimes(1);
      const createArg = tx.financeLedger.create.mock.calls[0]?.[0] as {
        data: { subjectId: string; paymentItemId: string; source: string };
      };
      expect(createArg.data.subjectId).toBe('subj-resale');
      expect(createArg.data.paymentItemId).toBe('item-1');
      expect(createArg.data.source).toBe('crm_payment');
    });

    it('12. item.financeSubjectId=NULL → 用兜底 non_pl.uncategorized', async () => {
      const item = buildItem({ financeSubjectId: null });
      const tx = buildTx({ payment: buildPayment({ paymentItems: [item] }) });
      await service.syncFromPayment(asTx(tx), 'payment-x');
      const createArg = tx.financeLedger.create.mock.calls[0]?.[0] as {
        data: { subjectId: string };
      };
      expect(createArg.data.subjectId).toBe(SUBJECT_ROW.id);
    });

    it('13. 多 item 混合（direct + dingtalk_collect）→ 只派生 direct', async () => {
      const tx = buildTx({
        payment: buildPayment({
          paymentItems: [
            buildItem({
              id: 'item-1',
              itemSeq: 1,
              paymentMode: 'direct',
              amount: new Decimal('70'),
            }),
            buildItem({
              id: 'item-2',
              itemSeq: 2,
              paymentMode: 'dingtalk_collect',
              amount: new Decimal('30'),
            }),
          ],
        }),
      });
      await service.syncFromPayment(asTx(tx), 'payment-x');
      expect(tx.financeLedger.create).toHaveBeenCalledTimes(1);
      const createArg = tx.financeLedger.create.mock.calls[0]?.[0] as {
        data: { paymentItemId: string };
      };
      expect(createArg.data.paymentItemId).toBe('item-1');
    });

    it('14. 撤回后复活（existing 已软删 + item.financeSubjectId 有值）→ 覆写 subjectId', async () => {
      const item = buildItem({ id: 'item-1', financeSubjectId: 'subj-new' });
      const existing = { id: 'ledger-1', subjectId: 'subj-old', deletedAt: new Date() };
      const tx = buildTx({
        payment: buildPayment({ paymentItems: [item] }),
        existingLedgerByItem: { 'item-1': existing },
      });
      await service.syncFromPayment(asTx(tx), 'payment-x');
      expect(tx.financeLedger.update).toHaveBeenCalledTimes(1);
      const updateArg = tx.financeLedger.update.mock.calls[0]?.[0] as {
        data: { subjectId: string; deletedAt: null };
      };
      expect(updateArg.data.subjectId).toBe('subj-new');
      expect(updateArg.data.deletedAt).toBeNull();
    });

    it('15. 已存在活 ledger（subject 被 admin 改过）→ 保留 admin 的 subjectId', async () => {
      const item = buildItem({ id: 'item-1', financeSubjectId: 'subj-new' });
      const existing = { id: 'ledger-1', subjectId: 'subj-admin-changed', deletedAt: null };
      const tx = buildTx({
        payment: buildPayment({ paymentItems: [item] }),
        existingLedgerByItem: { 'item-1': existing },
      });
      await service.syncFromPayment(asTx(tx), 'payment-x');
      const updateArg = tx.financeLedger.update.mock.calls[0]?.[0] as {
        data: { subjectId: string };
      };
      expect(updateArg.data.subjectId).toBe('subj-admin-changed');
    });

    it('16. orphan 清理：仅 item-1 存活 → updateMany where paymentItemId notIn [item-1]', async () => {
      const tx = buildTx({
        payment: buildPayment({ paymentItems: [buildItem({ id: 'item-1' })] }),
      });
      await service.syncFromPayment(asTx(tx), 'payment-x');
      expect(tx.financeLedger.updateMany).toHaveBeenCalledTimes(1);
      const arg = tx.financeLedger.updateMany.mock.calls[0]?.[0] as {
        where: { paymentItemId: { notIn?: string[]; not?: string | null } };
      };
      expect(arg.where.paymentItemId).toEqual({ notIn: ['item-1'] });
    });
  });

  describe('revokeFromPayment', () => {
    it('17. 无存活派生 → no-op', async () => {
      const tx = buildTx({ revokeLedgers: [] });
      await service.revokeFromPayment(asTx(tx), 'payment-x', '撤回');
      expect(tx.financeLedger.update).not.toHaveBeenCalled();
    });

    it('18. N 条派生存活 → 逐条软删 + remark 追加', async () => {
      const tx = buildTx({
        revokeLedgers: [
          { id: 'ledger-1', remark: '[CRM] PAY-X - 钉钉' },
          { id: 'ledger-2', remark: '[CRM] PAY-X - 定制' },
        ],
      });
      await service.revokeFromPayment(asTx(tx), 'payment-x', '撤回审批');
      expect(tx.financeLedger.update).toHaveBeenCalledTimes(2);
      const call1 = tx.financeLedger.update.mock.calls[0]?.[0] as {
        data: { remark: string; deletedAt: Date };
      };
      expect(call1.data.remark).toContain('撤回审批');
      expect(call1.data.deletedAt).toBeInstanceOf(Date);
    });
  });
});
