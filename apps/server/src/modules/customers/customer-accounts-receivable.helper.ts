import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

/**
 * 客户应收账款的派生口径：
 *   SUM(sale_orders.totalUncollected WHERE customerId AND deletedAt IS NULL)
 *
 * 老 dingtalk-sync 已废弃后这个字段曾长期是脏数据；本 helper 把它切换为
 * "派生 + 物化" 模式：
 *   - 物化字段 Customer.accountsReceivable 仍保留（KPI/排行接口都依赖它做 SUM）
 *   - 但写入责任收归本 helper，由 Payment / SaleOrder 变更后触发
 *   - 因此外部读取语义不变，只是数据来源从"钉钉同步"变成"实时派生"
 *
 * 触发点（在 Commit 5 接入）：
 * - PaymentsService.create / update / remove
 * - PaymentsService.createRefund
 * - SaleOrdersService.create / update / remove
 * - approvals.service.ts 在 payment_approve / payment_refund_approve /
 *   sale_order_activate 通过/驳回/撤回后（已经通过 recalcSaleOrderPaymentSummary
 *   间接触发——本 helper 在 payment helper 末尾顺带跑一次）
 *
 * 调用方必须在 SaleOrder 全局锁图中持有 Customer 行锁。本 helper 属于主事务的一部分：
 * 回写失败必须向外抛出，让订单/回款/审批变更整体回滚，禁止提交半套派生事实。
 */
export async function recomputeCustomerAccountsReceivable(
  prisma: PrismaLike,
  customerId: string
): Promise<void> {
  // 软删客户跳过：findFirst 兼容 deletedAt 过滤
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: { id: true },
  });
  if (!customer) return;

  const agg = await prisma.saleOrder.aggregate({
    where: {
      customerId,
      deletedAt: null,
    },
    _sum: { totalUncollected: true },
  });

  const total =
    agg._sum.totalUncollected != null ? new Decimal(agg._sum.totalUncollected) : new Decimal(0);

  await prisma.customer.update({
    where: { id: customerId },
    data: {
      accountsReceivable: total.toFixed(2),
    },
  });
}
