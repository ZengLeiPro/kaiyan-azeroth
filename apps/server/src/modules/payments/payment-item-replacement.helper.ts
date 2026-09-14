import { isPaymentItemAmountTotalValid } from '@ky-azeroth/shared/schemas/payment';
import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { auditCreate, auditUpdate } from '../../common/utils/audit-helper';
import type { OrderProductReceivableService } from '../finance/receivables/order-product-receivable.service';

export type PaymentItemReplacement = {
  id?: string;
  version?: number;
  saleOrderProductId: string;
  amount: unknown;
  paymentMode: string;
  financeSubjectId?: string | null;
  productName?: string | null;
  remark?: string | null;
};

type CurrentUser = { id: string; employeeId?: string | null };

type OrderProductSnapshot = {
  id: string;
  saleOrderId: string;
  productName: string;
  financeSubjectId: string | null;
};

export async function validatePaymentItemSplit(
  tx: Prisma.TransactionClient,
  saleOrderId: string,
  paymentAmount: number,
  items: readonly PaymentItemReplacement[]
): Promise<Map<string, OrderProductSnapshot>> {
  if (items.length === 0) {
    throw new BadRequestException('回款必须至少拆分为一条 PaymentItem');
  }
  if (
    items.some(
      (item) =>
        typeof item.saleOrderProductId !== 'string' ||
        item.saleOrderProductId.length === 0 ||
        typeof item.paymentMode !== 'string' ||
        item.paymentMode.length === 0
    )
  ) {
    throw new BadRequestException('PaymentItem 缺少有效的订单产品或收款模式');
  }
  if (items.some((item) => !Number.isFinite(Number(item.amount)) || Number(item.amount) <= 0)) {
    throw new BadRequestException('PaymentItem 金额必须是有限正数');
  }
  const sum = items.reduce((total, item) => total + Number(item.amount), 0);
  if (!isPaymentItemAmountTotalValid(paymentAmount, items)) {
    throw new BadRequestException(
      `PaymentItem 金额加总 ${sum.toFixed(2)} 与回款金额 ` +
        `${Number(paymentAmount).toFixed(2)} 不一致（误差 ≥ 0.01）`
    );
  }

  const orderProductIds = [...new Set(items.map((item) => item.saleOrderProductId))];
  const orderProducts = await tx.orderProduct.findMany({
    where: { id: { in: orderProductIds }, deletedAt: null },
    select: {
      id: true,
      saleOrderId: true,
      productName: true,
      financeSubjectId: true,
    },
  });
  const orderProductMap = new Map(
    orderProducts.map((orderProduct) => [orderProduct.id, orderProduct])
  );
  for (const item of items) {
    const orderProduct = orderProductMap.get(item.saleOrderProductId);
    if (!orderProduct) {
      throw new BadRequestException(`订单产品 ${item.saleOrderProductId} 不存在或已删除，不能挂账`);
    }
    if (orderProduct.saleOrderId !== saleOrderId) {
      throw new BadRequestException(
        `订单产品 ${item.saleOrderProductId} 不属于销售订单 ${saleOrderId}，不能挂账`
      );
    }
  }
  return orderProductMap;
}

/** 在既有事务内逐行 version CAS 软删活动明细，并刷新受影响 OrderProduct 应收缓存。 */
export async function softDeletePaymentItemsInTransaction(
  tx: Prisma.TransactionClient,
  receivableService: OrderProductReceivableService,
  input: {
    paymentIds: readonly string[];
    deletedAt: Date;
    currentUser: CurrentUser;
  }
): Promise<void> {
  const paymentIds = [...new Set(input.paymentIds)].sort();
  const rows = await tx.paymentItem.findMany({
    where: { paymentId: { in: paymentIds }, deletedAt: null },
    select: { id: true, version: true, saleOrderProductId: true },
    orderBy: { id: 'asc' },
  });

  try {
    for (const row of rows) {
      await tx.paymentItem.update({
        where: { id: row.id, version: row.version, deletedAt: null },
        data: {
          deletedAt: input.deletedAt,
          version: { increment: 1 },
          ...auditUpdate(input.currentUser),
        },
      });
    }
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2025') {
      throw new ConflictException('回款明细已被其他用户修改，请刷新后重试');
    }
    throw error;
  }

  const affectedOrderProductIds = [...new Set(rows.map((row) => row.saleOrderProductId))].sort();
  await receivableService.recalculateBatch(tx, affectedOrderProductIds);
}

/**
 * 在既有事务内应用 PaymentItem 完整 replacement。
 *
 * 显式携带 id 的行按 id 保留既有 itemSeq；兼容直改 DTO 的无 id 行时，按当前活动顺序
 * 稳定复用尚未被显式 id 占用的行。每个保留行均使用 version CAS，新增行从历史最大
 * itemSeq 继续编号，未被 replacement 消费的活动行逐行 CAS 软删。
 */
export async function replacePaymentItemsInTransaction(
  tx: Prisma.TransactionClient,
  receivableService: Pick<OrderProductReceivableService, 'recalculateBatch'>,
  input: {
    paymentId: string;
    saleOrderId: string;
    paymentAmount: number;
    items: readonly PaymentItemReplacement[];
    currentUser: CurrentUser;
  }
): Promise<void> {
  const { paymentId, saleOrderId, paymentAmount, items, currentUser } = input;
  const opMap = await validatePaymentItemSplit(tx, saleOrderId, paymentAmount, items);
  const historicalRows = await tx.paymentItem.findMany({
    where: { paymentId },
    select: {
      id: true,
      itemSeq: true,
      saleOrderProductId: true,
      deletedAt: true,
      version: true,
    },
    orderBy: [{ itemSeq: 'asc' }, { id: 'asc' }],
  });
  const activeRows = historicalRows.filter((row) => row.deletedAt === null);
  const activeById = new Map(activeRows.map((row) => [row.id, row]));

  const explicitIds = items.flatMap((item) => (item.id === undefined ? [] : [item.id]));
  if (explicitIds.some((id) => typeof id !== 'string' || id.length === 0)) {
    throw new BadRequestException('PaymentItem id 无效');
  }
  if (new Set(explicitIds).size !== explicitIds.length) {
    throw new BadRequestException('PaymentItem replacement 不允许重复 id');
  }
  for (const item of items) {
    if (item.id === undefined) continue;
    const existing = activeById.get(item.id);
    if (!existing) {
      throw new BadRequestException(`PaymentItem ${item.id} 不属于该回款或已删除`);
    }
    if (
      item.version !== undefined &&
      (!Number.isInteger(item.version) || item.version < 1 || item.version !== existing.version)
    ) {
      throw new ConflictException(`PaymentItem ${item.id} 版本已变化，请刷新后重试`);
    }
  }

  const reservedIds = new Set(explicitIds);
  const implicitCandidates = activeRows.filter((row) => !reservedIds.has(row.id));
  const consumedIds = new Set<string>();
  const touchedOrderProductIds = new Set(activeRows.map((row) => row.saleOrderProductId));
  let implicitIndex = 0;
  let nextItemSeq = historicalRows.reduce((max, row) => Math.max(max, row.itemSeq), 0) + 1;

  try {
    for (const item of items) {
      const orderProduct = opMap.get(item.saleOrderProductId)!;
      const existing =
        item.id === undefined ? implicitCandidates[implicitIndex++] : activeById.get(item.id);
      touchedOrderProductIds.add(item.saleOrderProductId);

      if (!existing) {
        await tx.paymentItem.create({
          data: {
            paymentId,
            saleOrderProductId: item.saleOrderProductId,
            itemSeq: nextItemSeq,
            productName: item.productName ?? orderProduct.productName,
            amount: Number(item.amount).toFixed(2),
            financeSubjectId: item.financeSubjectId ?? orderProduct.financeSubjectId ?? undefined,
            paymentMode: item.paymentMode,
            remark: item.remark ?? undefined,
            ...auditCreate(currentUser),
          },
        });
        nextItemSeq += 1;
        continue;
      }

      consumedIds.add(existing.id);
      await tx.paymentItem.update({
        where: {
          id: existing.id,
          version: item.version ?? existing.version,
          deletedAt: null,
        },
        data: {
          saleOrderProductId: item.saleOrderProductId,
          productName: item.productName ?? orderProduct.productName,
          amount: Number(item.amount).toFixed(2),
          financeSubjectId: item.financeSubjectId ?? orderProduct.financeSubjectId ?? null,
          paymentMode: item.paymentMode,
          remark: item.remark ?? null,
          version: { increment: 1 },
          ...auditUpdate(currentUser),
        },
      });
    }

    const deletedAt = new Date();
    for (const staleItem of activeRows) {
      if (consumedIds.has(staleItem.id)) continue;
      await tx.paymentItem.update({
        where: { id: staleItem.id, version: staleItem.version, deletedAt: null },
        data: {
          deletedAt,
          version: { increment: 1 },
          ...auditUpdate(currentUser),
        },
      });
    }
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2025') {
      throw new ConflictException('PaymentItem 已被其他用户修改，请刷新后重试');
    }
    throw error;
  }

  await receivableService.recalculateBatch(tx, [...touchedOrderProductIds].sort());
}
