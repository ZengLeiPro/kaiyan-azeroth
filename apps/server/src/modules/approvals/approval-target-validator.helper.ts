import { APPROVAL_INSTANCE_STATUS, PAYMENT_DIRECTION } from '@ky-azeroth/shared/constants';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  applyCustomerCollabSelfScope,
  applyCustomerCollabViaCustomerScope,
  applyCustomerCollabViaCustomerWriteScope,
} from '../../common/services/data-scope.service';
import {
  lockSaleOrderFinancialGraph,
  validateFinancialSaleOrderAfterLock,
} from '../sale-orders/financial-limits.helper';
import {
  assertOpportunityHasNoActiveSaleOrder,
  lockSaleOrderRelationshipsBeforeCustomerTouch,
} from '../sale-orders/sale-order-opportunity-link.helper';

type Patch = Record<string, unknown>;

type ChangeTargetType =
  | 'customer'
  | 'sale_order'
  | 'invoice'
  | 'payment'
  | 'payment_refund'
  | 'visit_record';

type DirectTargetType = Exclude<ChangeTargetType, 'customer'> | 'project';
type PermissionAction = 'create' | 'edit' | 'delete';

/** 已加锁并完成实时权限、版本、状态、软删除与引用复验的目标 CAS 条件。 */
export interface LockedApprovalTarget {
  targetType: ChangeTargetType | 'project';
  where: Record<string, unknown>;
}

export interface ApprovalTargetValidationInput {
  targetType: ChangeTargetType;
  targetId: string;
  targetVersion: number;
  patch?: Patch;
  initiatorEmployeeId: string | null | undefined;
  eventType?: string;
}

export interface LiveApprovalScope {
  employeeId: string;
  chargerScope: string[] | null;
}

/**
 * 六类 change target 的不可绕过锁后 validator。
 *
 * 财务/SaleOrder 分支先建立 A 的完整图锁，再以版本、状态、deletedAt 与 scope 重读目标；
 * 仅识别受控的历史订单变更审批快照，其他 legacy/漂移/权限撤销均 fail-closed。
 */
export async function lockAndValidateApprovalChangeTargetForApproval(
  tx: Prisma.TransactionClient,
  input: ApprovalTargetValidationInput
): Promise<LockedApprovalTarget> {
  return lockAndValidateApprovalChangeTargetInternal(tx, input, 'approve');
}

/**
 * 驳回/撤回只消费当前业务快照，不应用申请 patch；仍然强制实时权限、精确版本、
 * 软删除、审批状态与当前关系校验。该入口与“最终引用落地”入口明确分离，不提供
 * 可选布尔旁路，避免调用方忘记开启最终引用校验。
 */
export async function lockAndValidateApprovalChangeTargetSnapshot(
  tx: Prisma.TransactionClient,
  input: ApprovalTargetValidationInput
): Promise<LockedApprovalTarget> {
  return lockAndValidateApprovalChangeTargetInternal(tx, input, 'snapshot');
}

async function lockAndValidateApprovalChangeTargetInternal(
  tx: Prisma.TransactionClient,
  input: ApprovalTargetValidationInput,
  mode: 'approve' | 'snapshot'
): Promise<LockedApprovalTarget> {
  assertTargetVersion(input.targetVersion);
  const action: PermissionAction =
    input.eventType?.includes('void') ||
    input.patch?.__operation === 'void' ||
    input.patch?.__operation === 'void_bundle'
      ? 'delete'
      : 'edit';
  const scope = await resolveLiveApprovalScope(
    tx,
    input.initiatorEmployeeId,
    'crm',
    targetMenu(input.targetType),
    action
  );
  const validateFinalReferences = mode === 'approve';
  const patch = validateFinalReferences ? (input.patch ?? {}) : {};

  switch (input.targetType) {
    case 'sale_order':
      return lockAndValidateSaleOrderChange(tx, input, patch, scope, validateFinalReferences);
    case 'invoice':
      return lockAndValidateInvoiceChange(tx, input, patch, scope, validateFinalReferences);
    case 'payment':
    case 'payment_refund':
      return lockAndValidatePaymentChange(tx, input, patch, scope, validateFinalReferences);
    case 'visit_record':
      return lockAndValidateVisitChange(tx, input, patch, scope, validateFinalReferences);
    case 'customer':
      return lockAndValidateCustomerChange(tx, input, scope);
  }
}

/**
 * 现有草稿/驳回/legacy NULL 单据提交审批前的锁后校验。调用方必须先提供锁前读到的
 * 精确版本与 flowStatus；本函数先走完整关系图，再按 version/status/deletedAt/scope
 * 重读，返回后调用方才可 CAS 抢占为 pending。
 */
export async function lockAndValidateApprovalSubmissionTarget(
  tx: Prisma.TransactionClient,
  input: {
    eventType: string;
    formId: string;
    targetVersion: number;
    expectedFlowStatus: string | null;
    initiatorEmployeeId: string | null | undefined;
  }
): Promise<LockedApprovalTarget> {
  return lockAndValidateDirectApprovalTarget(tx, input);
}

/**
 * 新建记录提审、审批决策与撤回共用的 pending 业务快照校验。legacy targetVersion=NULL
 * 一律 fail-closed；财务与订单必须先建立完整 SaleOrder 图锁。
 */
export async function lockAndValidatePendingApprovalTarget(
  tx: Prisma.TransactionClient,
  input: {
    eventType: string;
    formId: string;
    targetVersion: number | null | undefined;
    initiatorEmployeeId: string | null | undefined;
  }
): Promise<LockedApprovalTarget> {
  if (input.targetVersion == null) {
    throw new ConflictException('旧审批缺少业务目标版本快照，请撤回后重新发起');
  }
  return lockAndValidateDirectApprovalTarget(tx, {
    ...input,
    targetVersion: input.targetVersion,
    expectedFlowStatus: APPROVAL_INSTANCE_STATUS.PENDING,
  });
}

async function lockAndValidateDirectApprovalTarget(
  tx: Prisma.TransactionClient,
  input: {
    eventType: string;
    formId: string;
    targetVersion: number;
    expectedFlowStatus: string | null;
    initiatorEmployeeId: string | null | undefined;
  }
): Promise<LockedApprovalTarget> {
  assertTargetVersion(input.targetVersion);
  const directTarget = directTargetFromEvent(input.eventType);
  if (!directTarget) {
    throw new BadRequestException(`不支持 ${input.eventType} 类型的直接业务审批目标`);
  }

  const permission = directTargetPermission(directTarget);
  const scope = await resolveLiveApprovalScope(
    tx,
    input.initiatorEmployeeId,
    permission.module,
    permission.menu,
    'create'
  );

  if (directTarget === 'sale_order') {
    const pre = await tx.saleOrder.findUnique({
      where: { id: input.formId },
      select: { id: true, customerId: true, opportunityId: true },
    });
    if (!pre) throw staleTarget();
    await lockSaleOrderRelationshipsBeforeCustomerTouch(tx, [
      {
        saleOrderId: pre.id,
        opportunityId: pre.opportunityId,
        customerId: pre.customerId,
      },
    ]);
    const where: Prisma.SaleOrderWhereInput = {
      id: input.formId,
      version: input.targetVersion,
      flowStatus: input.expectedFlowStatus,
      deletedAt: null,
    };
    applyCustomerCollabViaCustomerWriteScope(where, scope.chargerScope, scope.employeeId);
    const order = await tx.saleOrder.findFirst({
      where,
      select: {
        id: true,
        customerId: true,
        opportunityId: true,
        chargerId: true,
      },
    });
    if (
      !order ||
      order.customerId !== pre.customerId ||
      order.opportunityId !== pre.opportunityId
    ) {
      throw staleTarget();
    }
    await validateSaleOrderFinalReferences(tx, order, scope, order.id, true);
    return { targetType: directTarget, where: where as Record<string, unknown> };
  }

  if (directTarget === 'invoice') {
    const pre = await tx.invoice.findUnique({
      where: { id: input.formId },
      select: { id: true, saleOrderId: true, customerId: true },
    });
    if (!pre) throw staleTarget();
    await lockSaleOrderFinancialGraph(tx, pre.saleOrderId);
    const where: Prisma.InvoiceWhereInput = {
      id: input.formId,
      version: input.targetVersion,
      flowStatus: input.expectedFlowStatus,
      deletedAt: null,
    };
    applyCustomerCollabViaCustomerWriteScope(where, scope.chargerScope, scope.employeeId);
    const invoice = await tx.invoice.findFirst({
      where,
      select: { id: true, saleOrderId: true, customerId: true },
    });
    if (
      !invoice ||
      invoice.saleOrderId !== pre.saleOrderId ||
      invoice.customerId !== pre.customerId
    ) {
      throw staleTarget();
    }
    await validateFinancialSaleOrderAfterLock(tx, {
      saleOrderId: invoice.saleOrderId,
      expectedCustomerId: invoice.customerId,
      chargerScope: scope.chargerScope,
      currentEmployeeId: scope.employeeId,
    });
    return { targetType: directTarget, where: where as Record<string, unknown> };
  }

  if (directTarget === 'payment' || directTarget === 'payment_refund') {
    const pre = await tx.payment.findUnique({
      where: { id: input.formId },
      select: { id: true, saleOrderId: true, customerId: true },
    });
    if (!pre) throw staleTarget();
    await lockSaleOrderFinancialGraph(tx, pre.saleOrderId);
    const expectedDirection =
      directTarget === 'payment_refund' ? PAYMENT_DIRECTION.OUT : PAYMENT_DIRECTION.IN;
    const where: Prisma.PaymentWhereInput = {
      id: input.formId,
      version: input.targetVersion,
      flowStatus: input.expectedFlowStatus,
      direction: expectedDirection,
      deletedAt: null,
    };
    applyCustomerCollabViaCustomerWriteScope(where, scope.chargerScope, scope.employeeId);
    const payment = await tx.payment.findFirst({
      where,
      select: {
        id: true,
        saleOrderId: true,
        customerId: true,
        chargerId: true,
        direction: true,
        relatedPaymentId: true,
        relatedInvoiceId: true,
      },
    });
    if (
      !payment ||
      payment.saleOrderId !== pre.saleOrderId ||
      payment.customerId !== pre.customerId
    ) {
      throw staleTarget();
    }
    await validateFinancialSaleOrderAfterLock(tx, {
      saleOrderId: payment.saleOrderId,
      expectedCustomerId: payment.customerId,
      chargerScope: scope.chargerScope,
      currentEmployeeId: scope.employeeId,
    });
    await validateEmployeeReference(tx, payment.chargerId, scope, '回款/退款负责人');
    if (payment.direction === PAYMENT_DIRECTION.OUT) {
      await validateRefundReferences(tx, payment);
    }
    return { targetType: directTarget, where: where as Record<string, unknown> };
  }

  if (directTarget === 'project') {
    // @prisma-raw-sql: Project 直接审批按目标行加锁，随后才复验当前引用。
    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "public"."projects"
      WHERE "id" = ${input.formId}
      FOR UPDATE
    `);
    const where: Prisma.ProjectWhereInput = {
      id: input.formId,
      version: input.targetVersion,
      flowStatus: input.expectedFlowStatus,
      deletedAt: null,
    };
    const project = await tx.project.findFirst({
      where,
      select: {
        id: true,
        customerId: true,
        opportunityId: true,
        saleOrderId: true,
        ownerId: true,
      },
    });
    if (!project) throw staleTarget();
    await validateProjectReferences(tx, project);
    return { targetType: directTarget, where: where as Record<string, unknown> };
  }

  const pre = await tx.visitRecord.findUnique({
    where: { id: input.formId },
    select: { customerId: true },
  });
  if (!pre) throw staleTarget();
  await lockVisitAndCustomers(tx, input.formId, [pre.customerId]);
  const where: Prisma.VisitRecordWhereInput = {
    id: input.formId,
    version: input.targetVersion,
    flowStatus: input.expectedFlowStatus,
    deletedAt: null,
  };
  applyCustomerCollabViaCustomerWriteScope(where, scope.chargerScope, scope.employeeId);
  const visit = await tx.visitRecord.findFirst({
    where,
    select: { id: true, customerId: true, contactId: true, chargerId: true },
  });
  if (!visit || visit.customerId !== pre.customerId) throw staleTarget();
  await validateVisitReferences(tx, visit, scope);
  return { targetType: directTarget, where: where as Record<string, unknown> };
}

export async function resolveLiveApprovalScope(
  tx: Prisma.TransactionClient,
  initiatorEmployeeId: string | null | undefined,
  module: string,
  menu: string,
  action: PermissionAction
): Promise<LiveApprovalScope> {
  if (!initiatorEmployeeId) {
    throw new ForbiddenException('审批缺少可验证的发起员工，拒绝继续');
  }
  const employee = await tx.employee.findFirst({
    where: { id: initiatorEmployeeId, deletedAt: null },
    select: { id: true },
  });
  if (!employee) throw new ForbiddenException('审批发起员工不存在或已删除，拒绝继续');

  const actionFilter =
    action === 'create'
      ? { create: true }
      : action === 'delete'
        ? { delete: true }
        : { edit: true };
  const permissions = await tx.rolePermission.findMany({
    where: {
      module,
      menu,
      ...actionFilter,
      role: {
        deletedAt: null,
        status: 'active',
        users: { some: { employeeId: initiatorEmployeeId } },
      },
    },
    select: { viewScope: true },
  });
  if (permissions.length === 0) {
    throw new ForbiddenException('审批发起人的模块权限已撤销，拒绝继续');
  }
  return {
    employeeId: initiatorEmployeeId,
    chargerScope: permissions.some((permission) => permission.viewScope === 'ALL')
      ? null
      : [initiatorEmployeeId],
  };
}

async function lockAndValidateSaleOrderChange(
  tx: Prisma.TransactionClient,
  input: ApprovalTargetValidationInput,
  patch: Patch,
  scope: LiveApprovalScope,
  validateFinalReferences: boolean
): Promise<LockedApprovalTarget> {
  const pre = await tx.saleOrder.findUnique({
    where: { id: input.targetId },
    select: { id: true, customerId: true, opportunityId: true },
  });
  if (!pre) throw staleTarget();
  const finalCustomerId = stringPatch(patch, 'customerId') ?? pre.customerId;
  const finalOpportunityId = hasPatch(patch, 'opportunityId')
    ? nullableStringPatch(patch, 'opportunityId')
    : pre.opportunityId;

  await lockSaleOrderRelationshipsBeforeCustomerTouch(
    tx,
    [{ saleOrderId: pre.id, opportunityId: pre.opportunityId, customerId: pre.customerId }],
    { opportunityIds: [finalOpportunityId], customerIds: [finalCustomerId] }
  );
  const scopeWhere: Prisma.SaleOrderWhereInput = {
    id: input.targetId,
    deletedAt: null,
  };
  applyCustomerCollabViaCustomerWriteScope(scopeWhere, scope.chargerScope, scope.employeeId);
  const order = await tx.saleOrder.findFirst({
    where: scopeWhere,
    select: {
      id: true,
      version: true,
      flowStatus: true,
      customerId: true,
      opportunityId: true,
      chargerId: true,
    },
  });
  const isCurrentApprovedTarget =
    order?.version === input.targetVersion &&
    order.flowStatus === APPROVAL_INSTANCE_STATUS.APPROVED;
  // 兼容早期变更审批在提交时将订单推进为 pending、版本加一的存量记录。
  // 仅限非作废订单变更，且版本必须严格等于基准版本 + 1，不能放宽真实并发修改的 CAS。
  const isLegacyPendingChangeTarget =
    input.eventType === 'sale_order_change' &&
    patch.__operation !== 'void' &&
    patch.__operation !== 'void_bundle' &&
    order?.version === input.targetVersion + 1 &&
    order.flowStatus === APPROVAL_INSTANCE_STATUS.PENDING;
  // 回款/开票等派生更新会推进订单版本，但不会直接改动变更申请里的业务字段。
  // 先允许取得最新 CAS 条件，字段级冲突由 applySaleOrderChange 基于 beforeSnapshot 判定。
  const isConcurrentApprovedSaleOrderChange =
    input.eventType === 'sale_order_change' &&
    patch.__operation !== 'void' &&
    patch.__operation !== 'void_bundle' &&
    order?.version != null &&
    order.version > input.targetVersion &&
    order.flowStatus === APPROVAL_INSTANCE_STATUS.APPROVED;
  if (
    !order ||
    (!isCurrentApprovedTarget &&
      !isLegacyPendingChangeTarget &&
      !isConcurrentApprovedSaleOrderChange) ||
    order.customerId !== pre.customerId ||
    order.opportunityId !== pre.opportunityId
  ) {
    throw staleTarget();
  }
  const where: Prisma.SaleOrderWhereInput = {
    ...scopeWhere,
    version: order.version,
    flowStatus: order.flowStatus,
  };
  if (
    !validateFinalReferences ||
    input.eventType === 'sale_order_void' ||
    patch.__operation === 'void_bundle'
  ) {
    // 纠错作废不会落地客户、商机或负责人引用；历史订单的关联商机可能已经软删，
    // 此时仍应允许在已完成 target CAS 与数据范围校验后清理该订单。
    return { targetType: input.targetType, where: where as Record<string, unknown> };
  }

  const finalChargerId = hasPatch(patch, 'chargerId')
    ? nullableStringPatch(patch, 'chargerId')
    : order.chargerId;
  await validateSaleOrderFinalReferences(
    tx,
    {
      customerId: finalCustomerId,
      opportunityId: finalOpportunityId,
      chargerId: finalChargerId,
    },
    scope,
    order.id,
    finalCustomerId !== order.customerId || finalOpportunityId !== order.opportunityId
  );
  if (finalCustomerId !== order.customerId) {
    const [payments, invoices, projects, secondaryProjects, ledgers] = await Promise.all([
      tx.payment.count({ where: { saleOrderId: order.id, deletedAt: null } }),
      tx.invoice.count({ where: { saleOrderId: order.id, deletedAt: null } }),
      tx.project.count({ where: { saleOrderId: order.id, deletedAt: null } }),
      tx.projectSaleOrder.count({ where: { saleOrderId: order.id } }),
      tx.financeLedger.count({ where: { saleOrderId: order.id, deletedAt: null } }),
    ]);
    if (payments + invoices + projects + secondaryProjects + ledgers > 0) {
      throw new BadRequestException('合同订单已有财务或项目子记录，不能修改客户');
    }
  }
  return { targetType: input.targetType, where: where as Record<string, unknown> };
}

async function lockAndValidateInvoiceChange(
  tx: Prisma.TransactionClient,
  input: ApprovalTargetValidationInput,
  patch: Patch,
  scope: LiveApprovalScope,
  validateFinalReferences: boolean
): Promise<LockedApprovalTarget> {
  const pre = await tx.invoice.findUnique({
    where: { id: input.targetId },
    select: { id: true, saleOrderId: true, customerId: true },
  });
  if (!pre) throw staleTarget();
  const finalSaleOrderId = stringPatch(patch, 'saleOrderId') ?? pre.saleOrderId;
  await lockSaleOrderFinancialGraph(tx, [pre.saleOrderId, finalSaleOrderId]);

  const where: Prisma.InvoiceWhereInput = {
    id: input.targetId,
    version: input.targetVersion,
    flowStatus: APPROVAL_INSTANCE_STATUS.APPROVED,
    deletedAt: null,
  };
  applyCustomerCollabViaCustomerWriteScope(where, scope.chargerScope, scope.employeeId);
  const invoice = await tx.invoice.findFirst({
    where,
    select: {
      id: true,
      saleOrderId: true,
      customerId: true,
      sourcePaymentIds: true,
    },
  });
  if (
    !invoice ||
    invoice.saleOrderId !== pre.saleOrderId ||
    invoice.customerId !== pre.customerId
  ) {
    throw staleTarget();
  }
  await validateFinancialSaleOrderAfterLock(tx, {
    saleOrderId: invoice.saleOrderId,
    expectedCustomerId: invoice.customerId,
    chargerScope: scope.chargerScope,
    currentEmployeeId: scope.employeeId,
  });
  if (!validateFinalReferences) {
    return { targetType: input.targetType, where: where as Record<string, unknown> };
  }

  const providedCustomerId = hasPatch(patch, 'customerId')
    ? nullableStringPatch(patch, 'customerId')
    : invoice.customerId;
  const finalOrder = await validateFinancialSaleOrderAfterLock(tx, {
    saleOrderId: finalSaleOrderId,
    expectedCustomerId: providedCustomerId,
    chargerScope: scope.chargerScope,
    currentEmployeeId: scope.employeeId,
  });
  if (providedCustomerId && finalOrder.customerId !== providedCustomerId) throw staleTarget();

  if (finalSaleOrderId !== invoice.saleOrderId) {
    const sourcePaymentIds = Array.isArray(invoice.sourcePaymentIds)
      ? invoice.sourcePaymentIds.filter(
          (value): value is string => typeof value === 'string' && value.length > 0
        )
      : [];
    const reverseReferenceCount = await tx.payment.count({
      where: {
        deletedAt: null,
        OR: [{ invoicedByInvoiceId: invoice.id }, { relatedInvoiceId: invoice.id }],
      },
    });
    if (sourcePaymentIds.length > 0 || reverseReferenceCount > 0) {
      throw new ConflictException('已有合并开票或退款反向引用的发票不能改绑合同订单');
    }
  }
  return { targetType: input.targetType, where: where as Record<string, unknown> };
}

async function lockAndValidatePaymentChange(
  tx: Prisma.TransactionClient,
  input: ApprovalTargetValidationInput,
  patch: Patch,
  scope: LiveApprovalScope,
  validateFinalReferences: boolean
): Promise<LockedApprovalTarget> {
  const pre = await tx.payment.findUnique({
    where: { id: input.targetId },
    select: { id: true, saleOrderId: true, customerId: true, direction: true },
  });
  if (!pre) throw staleTarget();
  const expectedDirection =
    input.targetType === 'payment_refund' ? PAYMENT_DIRECTION.OUT : PAYMENT_DIRECTION.IN;
  if (pre.direction !== expectedDirection) throw staleTarget();
  const finalSaleOrderId = stringPatch(patch, 'saleOrderId') ?? pre.saleOrderId;
  await lockSaleOrderFinancialGraph(tx, [pre.saleOrderId, finalSaleOrderId]);

  const where: Prisma.PaymentWhereInput = {
    id: input.targetId,
    version: input.targetVersion,
    flowStatus: APPROVAL_INSTANCE_STATUS.APPROVED,
    direction: expectedDirection,
    deletedAt: null,
  };
  applyCustomerCollabViaCustomerWriteScope(where, scope.chargerScope, scope.employeeId);
  const payment = await tx.payment.findFirst({
    where,
    select: {
      id: true,
      saleOrderId: true,
      customerId: true,
      chargerId: true,
      direction: true,
      relatedPaymentId: true,
      relatedInvoiceId: true,
    },
  });
  if (
    !payment ||
    payment.saleOrderId !== pre.saleOrderId ||
    payment.customerId !== pre.customerId
  ) {
    throw staleTarget();
  }
  await validateFinancialSaleOrderAfterLock(tx, {
    saleOrderId: payment.saleOrderId,
    expectedCustomerId: payment.customerId,
    chargerScope: scope.chargerScope,
    currentEmployeeId: scope.employeeId,
  });
  if (!validateFinalReferences) {
    return { targetType: input.targetType, where: where as Record<string, unknown> };
  }

  const providedCustomerId = hasPatch(patch, 'customerId')
    ? nullableStringPatch(patch, 'customerId')
    : payment.customerId;
  const finalOrder = await validateFinancialSaleOrderAfterLock(tx, {
    saleOrderId: finalSaleOrderId,
    expectedCustomerId: providedCustomerId,
    chargerScope: scope.chargerScope,
    currentEmployeeId: scope.employeeId,
  });
  const finalChargerId = hasPatch(patch, 'chargerId')
    ? nullableStringPatch(patch, 'chargerId')
    : payment.chargerId;
  await validateEmployeeReference(tx, finalChargerId, scope, '回款/退款负责人');
  if (providedCustomerId && finalOrder.customerId !== providedCustomerId) throw staleTarget();
  if (payment.direction === PAYMENT_DIRECTION.OUT) {
    await validateRefundReferences(tx, {
      saleOrderId: finalOrder.id,
      customerId: finalOrder.customerId,
      relatedPaymentId: hasPatch(patch, 'relatedPaymentId')
        ? nullableStringPatch(patch, 'relatedPaymentId')
        : payment.relatedPaymentId,
      relatedInvoiceId: hasPatch(patch, 'relatedInvoiceId')
        ? nullableStringPatch(patch, 'relatedInvoiceId')
        : payment.relatedInvoiceId,
    });
  }
  return { targetType: input.targetType, where: where as Record<string, unknown> };
}

async function lockAndValidateVisitChange(
  tx: Prisma.TransactionClient,
  input: ApprovalTargetValidationInput,
  patch: Patch,
  scope: LiveApprovalScope,
  validateFinalReferences: boolean
): Promise<LockedApprovalTarget> {
  const pre = await tx.visitRecord.findUnique({
    where: { id: input.targetId },
    select: { id: true, customerId: true },
  });
  if (!pre) throw staleTarget();
  const finalCustomerId = stringPatch(patch, 'customerId') ?? pre.customerId;
  await lockVisitAndCustomers(tx, input.targetId, [pre.customerId, finalCustomerId]);

  const where: Prisma.VisitRecordWhereInput = {
    id: input.targetId,
    version: input.targetVersion,
    flowStatus: APPROVAL_INSTANCE_STATUS.APPROVED,
    deletedAt: null,
  };
  applyCustomerCollabViaCustomerWriteScope(where, scope.chargerScope, scope.employeeId);
  const visit = await tx.visitRecord.findFirst({
    where,
    select: { id: true, customerId: true, contactId: true, chargerId: true },
  });
  if (!visit || visit.customerId !== pre.customerId) throw staleTarget();
  if (!validateFinalReferences) {
    return { targetType: input.targetType, where: where as Record<string, unknown> };
  }

  await validateVisitReferences(
    tx,
    {
      ...visit,
      customerId: finalCustomerId,
      contactId: hasPatch(patch, 'contactId')
        ? nullableStringPatch(patch, 'contactId')
        : visit.contactId,
      chargerId: hasPatch(patch, 'chargerId')
        ? nullableStringPatch(patch, 'chargerId')
        : visit.chargerId,
    },
    scope
  );
  return { targetType: input.targetType, where: where as Record<string, unknown> };
}

async function lockAndValidateCustomerChange(
  tx: Prisma.TransactionClient,
  input: ApprovalTargetValidationInput,
  scope: LiveApprovalScope
): Promise<LockedApprovalTarget> {
  // @prisma-raw-sql: Customer change target 也必须按精确版本真实加行锁。
  await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "public"."customers"
    WHERE "id" = ${input.targetId}
    FOR UPDATE
  `);
  const where: Prisma.CustomerWhereInput = {
    id: input.targetId,
    version: input.targetVersion,
    deletedAt: null,
  };
  applyCustomerCollabSelfScope(where, scope.chargerScope, scope.employeeId);
  const customer = await tx.customer.findFirst({ where, select: { id: true } });
  if (!customer) throw staleTarget();
  return { targetType: input.targetType, where: where as Record<string, unknown> };
}

async function validateSaleOrderFinalReferences(
  tx: Prisma.TransactionClient,
  refs: {
    customerId: string;
    opportunityId: string | null;
    chargerId: string | null;
  },
  scope: LiveApprovalScope,
  saleOrderId: string,
  assertOpportunityAvailability: boolean
): Promise<void> {
  const customerWhere: Prisma.CustomerWhereInput = { id: refs.customerId, deletedAt: null };
  applyCustomerCollabSelfScope(customerWhere, scope.chargerScope, scope.employeeId);
  const customer = await tx.customer.findFirst({ where: customerWhere, select: { id: true } });
  if (!customer) throw new ForbiddenException('最终客户不存在、已删除或超出发起人的范围');
  await validateEmployeeReference(tx, refs.chargerId, scope, '合同订单负责人');
  if (!refs.opportunityId) return;

  const opportunityWhere: Prisma.OpportunityWhereInput = {
    id: refs.opportunityId,
    customerId: refs.customerId,
    deletedAt: null,
  };
  applyCustomerCollabViaCustomerScope(opportunityWhere, scope.chargerScope, scope.employeeId);
  const opportunity = await tx.opportunity.findFirst({
    where: opportunityWhere,
    select: { id: true },
  });
  if (!opportunity) {
    throw new ForbiddenException('最终商机不存在、已删除、越权或与最终客户不一致');
  }
  if (assertOpportunityAvailability) {
    await assertOpportunityHasNoActiveSaleOrder(tx, refs.opportunityId, saleOrderId);
  }
}

async function validateVisitReferences(
  tx: Prisma.TransactionClient,
  visit: { customerId: string; contactId: string | null; chargerId: string | null },
  scope: LiveApprovalScope
): Promise<void> {
  const customerWhere: Prisma.CustomerWhereInput = { id: visit.customerId, deletedAt: null };
  applyCustomerCollabSelfScope(customerWhere, scope.chargerScope, scope.employeeId);
  const customer = await tx.customer.findFirst({ where: customerWhere, select: { id: true } });
  if (!customer) throw new ForbiddenException('拜访最终客户不存在、已删除或已超出发起人范围');
  if (visit.contactId) {
    const contact = await tx.contact.findFirst({
      where: { id: visit.contactId, customerId: visit.customerId, deletedAt: null },
      select: { id: true },
    });
    if (!contact) throw new BadRequestException('拜访最终联系人不存在、已删除或不属于最终客户');
  }
  await validateEmployeeReference(tx, visit.chargerId, scope, '拜访负责人');
}

async function validateRefundReferences(
  tx: Prisma.TransactionClient,
  payment: {
    saleOrderId: string;
    customerId: string;
    relatedPaymentId: string | null;
    relatedInvoiceId: string | null;
  }
): Promise<void> {
  if (!payment.relatedPaymentId) throw new BadRequestException('退款缺少关联原回款');
  const relatedPayment = await tx.payment.findFirst({
    where: {
      id: payment.relatedPaymentId,
      saleOrderId: payment.saleOrderId,
      customerId: payment.customerId,
      direction: PAYMENT_DIRECTION.IN,
      flowStatus: APPROVAL_INSTANCE_STATUS.APPROVED,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!relatedPayment) throw new BadRequestException('关联原回款已删除、未审批或关系已变化');
  if (payment.relatedInvoiceId) {
    const invoice = await tx.invoice.findFirst({
      where: {
        id: payment.relatedInvoiceId,
        saleOrderId: payment.saleOrderId,
        customerId: payment.customerId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!invoice) throw new BadRequestException('关联发票已删除或关系已变化');
  }
}

async function validateProjectReferences(
  tx: Prisma.TransactionClient,
  project: {
    customerId: string | null;
    opportunityId: string | null;
    saleOrderId: string | null;
    ownerId: string | null;
  }
): Promise<void> {
  if (project.ownerId) {
    const owner = await tx.employee.findFirst({
      where: { id: project.ownerId, deletedAt: null },
      select: { id: true },
    });
    if (!owner) throw new BadRequestException('项目负责人不存在或已删除');
  }
  if (project.customerId) {
    const customer = await tx.customer.findFirst({
      where: { id: project.customerId, deletedAt: null },
      select: { id: true },
    });
    if (!customer) throw new BadRequestException('项目客户不存在或已删除');
  }
  if (project.opportunityId) {
    const opportunity = await tx.opportunity.findFirst({
      where: {
        id: project.opportunityId,
        ...(project.customerId ? { customerId: project.customerId } : {}),
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!opportunity) throw new BadRequestException('项目商机不存在、已删除或客户关系已变化');
  }
  if (project.saleOrderId) {
    const saleOrder = await tx.saleOrder.findFirst({
      where: {
        id: project.saleOrderId,
        ...(project.customerId ? { customerId: project.customerId } : {}),
        ...(project.opportunityId ? { opportunityId: project.opportunityId } : {}),
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!saleOrder) throw new BadRequestException('项目合同订单不存在、已删除或关系已变化');
  }
}

async function validateEmployeeReference(
  tx: Prisma.TransactionClient,
  employeeId: string | null | undefined,
  scope: LiveApprovalScope,
  label: string
): Promise<void> {
  if (!employeeId) throw new BadRequestException(`${label}不能为空`);
  const employee = await tx.employee.findFirst({
    where: {
      id: scope.chargerScope === null ? employeeId : { equals: employeeId, in: scope.chargerScope },
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!employee) throw new ForbiddenException(`${label}不存在、已删除或超出发起人范围`);
}

async function lockVisitAndCustomers(
  tx: Prisma.TransactionClient,
  visitId: string,
  customerIds: readonly string[]
): Promise<void> {
  // @prisma-raw-sql: Visit target 必须先于其 Customer 引用加锁，锁后再校验 scope/版本。
  await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "public"."visit_records"
    WHERE "id" = ${visitId}
    FOR UPDATE
  `);
  const ids = [...new Set(customerIds.filter(Boolean))].sort();
  if (ids.length === 0) return;
  // @prisma-raw-sql: 新旧 Customer 固定排序，防止 Visit A↔B 改绑死锁。
  await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "public"."customers"
    WHERE "id" IN (${Prisma.join(ids)})
    ORDER BY "id"
    FOR UPDATE
  `);
}

function targetMenu(targetType: ChangeTargetType): string {
  switch (targetType) {
    case 'customer':
      return 'customers';
    case 'sale_order':
      return 'sale_orders';
    case 'invoice':
      return 'invoices';
    case 'payment':
    case 'payment_refund':
      return 'payments';
    case 'visit_record':
      return 'visit_records';
  }
}

function directTargetFromEvent(eventType: string): DirectTargetType | null {
  switch (eventType) {
    case 'sale_order_activate':
      return 'sale_order';
    case 'invoice_approve':
      return 'invoice';
    case 'payment_approve':
      return 'payment';
    case 'payment_refund_approve':
      return 'payment_refund';
    case 'visit_approve':
      return 'visit_record';
    case 'project_launch':
      return 'project';
    default:
      return null;
  }
}

function directTargetPermission(targetType: DirectTargetType): { module: string; menu: string } {
  if (targetType === 'project') {
    return { module: 'projects', menu: 'project_list' };
  }
  return { module: 'crm', menu: targetMenu(targetType) };
}

function assertTargetVersion(version: number): void {
  if (!Number.isInteger(version) || version < 1) throw staleTarget();
}

function staleTarget(): ConflictException {
  return new ConflictException('审批目标版本、状态、删除状态、关系或访问范围已变化，请刷新后重试');
}

function hasPatch(patch: Patch, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(patch, key);
}

function stringPatch(patch: Patch, key: string): string | undefined {
  const value = patch[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function nullableStringPatch(patch: Patch, key: string): string | null {
  const value = patch[key];
  if (value == null || value === '') return null;
  return typeof value === 'string' ? value : String(value);
}
