import {
  OPPORTUNITY_STAGE,
  PAYMENT_DIRECTION,
  PROJECT_CATEGORY,
  PROJECT_STATUS,
} from '@ky-azeroth/shared/constants';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { auditCreate, auditUpdate } from '../../common/utils/audit-helper';

export const CUSTOM_DEVELOPMENT_PRODUCT_NAME = '定制开发';
export const AUTO_PROJECT_NAME = '待定项目';

type LifecycleUser = { id: string; employeeId?: string | null };
type AutoProjectStatus =
  | typeof PROJECT_STATUS.OPPORTUNITY
  | typeof PROJECT_STATUS.CONTRACT
  | typeof PROJECT_STATUS.NOT_STARTED;

interface OpportunityProjectSource {
  opportunityId: string;
  customerId: string;
  ownerId?: string | null;
  productNames: string[];
  opportunityStage?: string | null;
  saleOrderId?: string | null;
}

interface EnsureProjectOptions {
  createIfMissing?: boolean;
  reactivateLostProject?: boolean;
}

interface AdvanceProjectOptions {
  createIfMissing: boolean;
}

const AUTO_STATUS_RANK = new Map<AutoProjectStatus, number>([
  [PROJECT_STATUS.OPPORTUNITY, 0],
  [PROJECT_STATUS.CONTRACT, 1],
  [PROJECT_STATUS.NOT_STARTED, 2],
]);

export function hasCustomDevelopmentProduct(productNames: string[]): boolean {
  return productNames.some((name) => name.trim() === CUSTOM_DEVELOPMENT_PRODUCT_NAME);
}

/**
 * 为「定制开发」商机创建或正向推进唯一项目。
 *
 * 只认识 商机中 → 合同中 → 未开始 三段自动状态；项目一旦进入进行中、暂停等人工阶段，
 * 自动化不再覆盖，避免后续补录订单/回款把真实项目状态倒退。
 */
export async function ensureCustomDevelopmentProject(
  tx: Prisma.TransactionClient,
  source: OpportunityProjectSource,
  targetStatus: AutoProjectStatus,
  currentUser: LifecycleUser,
  options: EnsureProjectOptions = {}
) {
  // 同一商机的项目首次创建必须串行化，避免“商机保存 / 订单审批 / 回款审批”并发时
  // 一方裸露唯一约束 P2002，并连带回滚业务事务。
  // @prisma-raw-sql: PostgreSQL 事务级 advisory lock 串行化同一商机的项目生命周期写入。
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${'project_lifecycle:' + source.opportunityId}, 0))`
  );

  const existingByOpportunity = await tx.project.findUnique({
    where: { opportunityId: source.opportunityId },
  });

  const existingBySaleOrder = source.saleOrderId
    ? await tx.project.findUnique({ where: { saleOrderId: source.saleOrderId } })
    : null;

  if (
    existingBySaleOrder &&
    existingBySaleOrder.opportunityId &&
    existingBySaleOrder.opportunityId !== source.opportunityId
  ) {
    throw new ConflictException('该合同订单已关联其他商机的项目，请先修正项目关联');
  }

  if (
    existingByOpportunity &&
    existingBySaleOrder &&
    existingByOpportunity.id !== existingBySaleOrder.id
  ) {
    throw new ConflictException('商机和合同订单分别关联了不同项目，请先修正项目关联');
  }

  // 历史数据允许一商机多订单。项目已经绑定订单 A 时，订单 B 的审批/回款不能跨单
  // 推进 A 的项目；保持历史记录可正常处理，但生命周期事件只作用于精确绑定的订单。
  if (
    source.saleOrderId &&
    existingByOpportunity?.saleOrderId &&
    existingByOpportunity.saleOrderId !== source.saleOrderId &&
    !existingBySaleOrder
  ) {
    return existingByOpportunity;
  }

  const existing = existingByOpportunity ?? existingBySaleOrder;

  const data: Prisma.ProjectUncheckedUpdateInput = {};
  if (existing && existing.customerId !== source.customerId) {
    if (existing.saleOrderId) {
      throw new ConflictException('商机客户与已关联项目/合同订单不一致，请先修正关联关系');
    }
    data.customerId = source.customerId;
  }

  // 输单是终态门禁：无论来自商机保存、订单审批还是回款审批，都不能创建或推进项目。
  // 仅“商机中且未绑定订单”的项目随商机转为“流失”；人工阶段与合同后阶段不覆盖。
  // 商机移除“定制开发”时同样不再推进；但已有项目的客户关系仍需保持一致。
  if (
    source.opportunityStage === OPPORTUNITY_STAGE.LOST ||
    !hasCustomDevelopmentProduct(source.productNames)
  ) {
    if (!existing) return null;
    if (
      source.opportunityStage === OPPORTUNITY_STAGE.LOST &&
      existing.status === PROJECT_STATUS.OPPORTUNITY &&
      !existing.saleOrderId
    ) {
      data.status = PROJECT_STATUS.LOST;
    }
    if (Object.keys(data).length === 0) return existing;
    return tx.project.update({
      where: { id: existing.id },
      data: {
        ...data,
        ...auditUpdate(currentUser),
        version: { increment: 1 },
      },
    });
  }

  let resolvedTargetStatus = targetStatus;
  if (source.saleOrderId && targetStatus === PROJECT_STATUS.CONTRACT) {
    const approvedPayment = await tx.payment.findFirst({
      where: {
        saleOrderId: source.saleOrderId,
        direction: PAYMENT_DIRECTION.IN,
        flowStatus: 'approved',
        deletedAt: null,
      },
      select: { id: true },
    });
    if (approvedPayment) resolvedTargetStatus = PROJECT_STATUS.NOT_STARTED;
  }

  if (!existing) {
    if (options.createIfMissing === false) return null;

    try {
      return await tx.project.create({
        data: {
          name: AUTO_PROJECT_NAME,
          status: resolvedTargetStatus,
          category: PROJECT_CATEGORY.CUSTOM_DEV,
          customerId: source.customerId,
          opportunityId: source.opportunityId,
          saleOrderId: source.saleOrderId ?? undefined,
          ownerId: source.ownerId ?? undefined,
          ...auditCreate(currentUser),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('该商机或合同订单已关联其他项目，请刷新后重试');
      }
      throw error;
    }
  }

  if (!existing.opportunityId) data.opportunityId = source.opportunityId;
  if (!existing.saleOrderId && source.saleOrderId) data.saleOrderId = source.saleOrderId;

  // 只有商机从“输单流失”被显式重新打开时，才恢复此前由本 helper 标记的
  // “流失”项目；普通编辑不会把人工置为“流失”的项目自动改回。
  if (
    options.reactivateLostProject &&
    existing.status === PROJECT_STATUS.LOST &&
    !existing.saleOrderId
  ) {
    data.status = PROJECT_STATUS.OPPORTUNITY;
  }

  const currentRank = AUTO_STATUS_RANK.get(existing.status as AutoProjectStatus);
  const targetRank = AUTO_STATUS_RANK.get(resolvedTargetStatus);
  if (currentRank !== undefined && targetRank !== undefined && currentRank < targetRank) {
    data.status = resolvedTargetStatus;
  }

  if (Object.keys(data).length === 0) return existing;

  return tx.project.update({
    where: { id: existing.id },
    data: {
      ...data,
      ...auditUpdate(currentUser),
      version: { increment: 1 },
    },
  });
}

/**
 * 从已审批合同订单（或其已审批回款）反查定制开发商机，并推进对应项目。
 */
export async function advanceCustomDevelopmentProjectFromSaleOrder(
  tx: Prisma.TransactionClient,
  saleOrderId: string,
  targetStatus: AutoProjectStatus,
  currentUser: LifecycleUser,
  options: AdvanceProjectOptions
) {
  const saleOrder = await tx.saleOrder.findFirst({
    where: { id: saleOrderId, deletedAt: null },
    select: {
      id: true,
      opportunity: {
        select: {
          id: true,
          customerId: true,
          chargerId: true,
          opportunityStage: true,
          deletedAt: true,
          products: {
            where: {
              deletedAt: null,
              productName: CUSTOM_DEVELOPMENT_PRODUCT_NAME,
            },
            select: { productName: true },
            take: 1,
          },
        },
      },
    },
  });

  const opportunity = saleOrder?.opportunity;
  if (!opportunity || opportunity.deletedAt || opportunity.products.length === 0) return null;

  return ensureCustomDevelopmentProject(
    tx,
    {
      opportunityId: opportunity.id,
      customerId: opportunity.customerId,
      ownerId: opportunity.chargerId,
      productNames: opportunity.products.map((product) => product.productName),
      opportunityStage: opportunity.opportunityStage,
      saleOrderId: saleOrder.id,
    },
    targetStatus,
    currentUser,
    options
  );
}

/** 已关联项目存在时，订单不得单独改绑客户或商机，避免项目与订单形成确定性错链。 */
export async function assertSaleOrderProjectRelationUnchanged(
  tx: Prisma.TransactionClient,
  saleOrderId: string,
  finalCustomerId: string,
  finalOpportunityId: string | null
): Promise<void> {
  const project = await tx.project.findUnique({
    where: { saleOrderId },
    select: { customerId: true, opportunityId: true },
  });
  if (!project) return;

  if (project.customerId !== finalCustomerId || project.opportunityId !== finalOpportunityId) {
    throw new ConflictException('合同订单已关联项目，不能单独改绑客户或商机，请先调整项目关联');
  }
}
