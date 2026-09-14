import {
  APPROVAL_INSTANCE_STATUS,
  INVOICE_STATUS,
  KEEP_RECORD_SOURCE,
  LEAD_PROGRESS_STATUS,
  PAYMENT_DIRECTION,
  PROJECT_STATUS,
} from '@ky-azeroth/shared/constants';
import type { ApprovalActionSideEffectsInput } from '@ky-azeroth/shared/schemas/approval';
import {
  SALE_ORDER_VOID_PROJECT_ACTION,
  saleOrderDateOnlySchema,
} from '@ky-azeroth/shared/schemas/sale-order';
import type { IApprovalChangeRequestResponse } from '@ky-azeroth/shared/types';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type ApprovalChangeRequest, Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import {
  applyCustomerCollabSelfScope,
  applyCustomerCollabViaCustomerScope,
} from '../../common/services/data-scope.service';
import { auditCreate, auditUpdate } from '../../common/utils/audit-helper';
import { parseClientDateTime } from '../../common/utils/date-helpers';
import { fromJsonValue, toJsonValue } from '../../common/utils/json-type-helpers';
import { serializeEntity } from '../../common/utils/response-helpers';
import { recomputeCustomerAccountsReceivable } from '../customers/customer-accounts-receivable.helper';
import { recomputeCustomerLifecycle } from '../customers/customer-lifecycle';
import { OrderProductReceivableService } from '../finance/receivables/order-product-receivable.service';
import { FinanceLedgerSyncService } from '../finance/sync/finance-ledger-sync.service';
import { clearActivePaymentInvoiceReferences } from '../invoices/payment-invoice-reference.helper';
import {
  type PaymentItemReplacement,
  replacePaymentItemsInTransaction,
  softDeletePaymentItemsInTransaction,
} from '../payments/payment-item-replacement.helper';
import {
  advanceCustomDevelopmentProjectFromSaleOrder,
  assertSaleOrderProjectRelationUnchanged,
} from '../projects/project-lifecycle.helper';
import {
  assertInvoiceWithinOrderAmount,
  assertPaymentWithinReceivables,
  assertRefundWithinReceived,
  lockSaleOrderFinancialGraph,
} from '../sale-orders/financial-limits.helper';
import { recalcSaleOrderInvoicedSummary } from '../sale-orders/invoiced-summary.helper';
import { resolveOrderTitle } from '../sale-orders/order-title.helper';
import { recalcSaleOrderPaymentSummary } from '../sale-orders/payment-summary.helper';
import { reconcileSaleOrderActivationLifecycle } from '../sale-orders/sale-order-activation-lifecycle.helper';
import {
  assertOpportunityHasNoActiveSaleOrder,
  lockSaleOrderRelationshipsBeforeCustomerTouch,
} from '../sale-orders/sale-order-opportunity-link.helper';
import {
  buildSaleOrderVoidPlan,
  type SaleOrderVoidDependencySnapshot,
  saleOrderVoidSnapshotsEqual,
} from '../sale-orders/sale-order-void-plan.helper';
import {
  lockAndValidateApprovalChangeTargetForApproval,
  lockAndValidateApprovalChangeTargetSnapshot,
  type LockedApprovalTarget,
} from './approval-target-validator.helper';
import { buildApprovalInstanceVisibilityWhere } from './approval-visibility.helper';

type CurrentUser = { id: string; employeeId?: string | null };
type Patch = Record<string, unknown>;

const VOID_OPERATION = 'void';
const VOID_BUNDLE_OPERATION = 'void_bundle';

export const APPROVAL_CHANGE_TARGET_TYPE = {
  SALE_ORDER: 'sale_order',
  INVOICE: 'invoice',
  PAYMENT: 'payment',
  PAYMENT_REFUND: 'payment_refund',
  VISIT_RECORD: 'visit_record',
  CUSTOMER: 'customer',
} as const;

export type ApprovalChangeTargetType =
  (typeof APPROVAL_CHANGE_TARGET_TYPE)[keyof typeof APPROVAL_CHANGE_TARGET_TYPE];

@Injectable()
export class ApprovalChangeRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financeLedgerSync: FinanceLedgerSyncService,
    private readonly receivableService: OrderProductReceivableService
  ) {}

  async findOneById(
    id: string,
    viewerId: string,
    hasAllScope: boolean
  ): Promise<IApprovalChangeRequestResponse> {
    const change = await this.prisma.approvalChangeRequest.findFirst({
      where: {
        id,
        deletedAt: null,
        approvalInstance: {
          is: buildApprovalInstanceVisibilityWhere(viewerId, hasAllScope),
        },
      },
    });
    if (!change) {
      throw new NotFoundException('审批变更申请不存在');
    }
    return serializeEntity<IApprovalChangeRequestResponse>({ ...change });
  }

  async validatePendingTargetSnapshot(
    tx: Prisma.TransactionClient,
    eventType: string,
    formId: string,
    targetVersion: number | null | undefined
  ): Promise<boolean> {
    const change = await this.findPendingChange(tx, eventType, formId);
    if (!change) return false;
    this.assertInstanceTargetVersion(change, targetVersion);
    await lockAndValidateApprovalChangeTargetSnapshot(tx, this.validationInput(change));
    return true;
  }

  async validatePendingTargetForApproval(
    tx: Prisma.TransactionClient,
    eventType: string,
    formId: string,
    targetVersion: number | null | undefined
  ): Promise<boolean> {
    const change = await this.findPendingChange(tx, eventType, formId);
    if (!change) return false;
    this.assertInstanceTargetVersion(change, targetVersion);
    await lockAndValidateApprovalChangeTargetForApproval(tx, this.validationInput(change));
    return true;
  }

  async handleApprovalResult(
    tx: Prisma.TransactionClient,
    eventType: string,
    formId: string,
    targetVersion: number | null | undefined,
    status: 'approved' | 'rejected',
    currentUser: CurrentUser,
    sideEffects?: ApprovalActionSideEffectsInput
  ): Promise<boolean> {
    const change = await this.findPendingChange(tx, eventType, formId);
    if (!change) return false;
    this.assertInstanceTargetVersion(change, targetVersion);

    if (status === APPROVAL_INSTANCE_STATUS.APPROVED) {
      const lockedTarget = await lockAndValidateApprovalChangeTargetForApproval(
        tx,
        this.validationInput(change)
      );
      try {
        await this.applyApprovedChange(tx, change, lockedTarget, currentUser, sideEffects);
      } catch (error) {
        if (hasPrismaErrorCode(error, 'P2025')) {
          throw new ConflictException('审批目标版本、状态、删除状态或访问范围已变化');
        }
        throw error;
      }
    } else {
      await lockAndValidateApprovalChangeTargetSnapshot(tx, this.validationInput(change));
    }

    const completedAt = new Date();
    const completed = await tx.approvalChangeRequest.updateMany({
      where: {
        id: change.id,
        version: change.version,
        status: APPROVAL_INSTANCE_STATUS.PENDING,
        deletedAt: null,
      },
      data: {
        status,
        completedAt,
        ...(status === APPROVAL_INSTANCE_STATUS.APPROVED ? { appliedAt: completedAt } : {}),
        version: { increment: 1 },
        ...auditUpdate(currentUser),
      },
    });
    if (completed.count !== 1) {
      throw new ConflictException('变更申请状态已变化，请刷新后重试');
    }
    return true;
  }

  async handleWithdraw(
    tx: Prisma.TransactionClient,
    eventType: string,
    formId: string,
    targetVersion: number | null | undefined,
    currentUser: CurrentUser
  ): Promise<boolean> {
    const change = await this.findPendingChange(tx, eventType, formId);
    if (!change) return false;
    this.assertInstanceTargetVersion(change, targetVersion);
    await lockAndValidateApprovalChangeTargetSnapshot(tx, this.validationInput(change));

    const withdrawn = await tx.approvalChangeRequest.updateMany({
      where: {
        id: change.id,
        version: change.version,
        status: APPROVAL_INSTANCE_STATUS.PENDING,
        deletedAt: null,
      },
      data: {
        status: APPROVAL_INSTANCE_STATUS.WITHDRAWN,
        completedAt: new Date(),
        version: { increment: 1 },
        ...auditUpdate(currentUser),
      },
    });
    if (withdrawn.count !== 1) {
      throw new ConflictException('变更申请状态已变化，请刷新后重试');
    }
    return true;
  }

  private async findPendingChange(
    tx: Prisma.TransactionClient,
    eventType: string,
    formId: string
  ): Promise<ApprovalChangeRequest | null> {
    return tx.approvalChangeRequest.findFirst({
      where: {
        id: formId,
        eventType,
        deletedAt: null,
        status: APPROVAL_INSTANCE_STATUS.PENDING,
      },
    });
  }

  private assertInstanceTargetVersion(
    change: ApprovalChangeRequest,
    targetVersion: number | null | undefined
  ): void {
    if (
      targetVersion == null ||
      !Number.isInteger(targetVersion) ||
      targetVersion < 1 ||
      targetVersion !== change.baseVersion
    ) {
      throw new ConflictException('审批目标版本快照缺失或已变化，请撤回后重新发起');
    }
  }

  private validationInput(change: ApprovalChangeRequest) {
    if (!isApprovalChangeTargetType(change.targetType)) {
      throw new BadRequestException(`不支持 ${change.targetType} 类型的变更申请`);
    }
    return {
      targetType: change.targetType,
      targetId: change.targetId,
      targetVersion: change.baseVersion,
      patch: readPatch(change),
      initiatorEmployeeId: change.creatorEmployeeId,
      eventType: change.eventType,
    };
  }

  async findOne(
    prisma: PrismaService | Prisma.TransactionClient,
    id: string
  ): Promise<IApprovalChangeRequestResponse> {
    const change = await prisma.approvalChangeRequest.findFirst({
      where: { id, deletedAt: null },
    });
    if (!change) {
      throw new NotFoundException('审批变更申请不存在');
    }
    return serializeEntity<IApprovalChangeRequestResponse>(
      change as unknown as Record<string, unknown>
    );
  }

  private async applyApprovedChange(
    tx: Prisma.TransactionClient,
    change: ApprovalChangeRequest,
    lockedTarget: LockedApprovalTarget,
    currentUser: CurrentUser,
    sideEffects?: ApprovalActionSideEffectsInput
  ): Promise<void> {
    if (lockedTarget.targetType !== change.targetType) {
      throw new ConflictException('变更审批目标类型已变化，请刷新后重试');
    }
    switch (change.targetType) {
      case APPROVAL_CHANGE_TARGET_TYPE.SALE_ORDER:
        await this.applySaleOrderChange(tx, change, lockedTarget.where, currentUser);
        return;
      case APPROVAL_CHANGE_TARGET_TYPE.INVOICE:
        await this.applyInvoiceChange(tx, change, lockedTarget.where, currentUser);
        return;
      case APPROVAL_CHANGE_TARGET_TYPE.PAYMENT:
      case APPROVAL_CHANGE_TARGET_TYPE.PAYMENT_REFUND:
        await this.applyPaymentChange(tx, change, lockedTarget.where, currentUser);
        return;
      case APPROVAL_CHANGE_TARGET_TYPE.VISIT_RECORD:
        await this.applyVisitRecordChange(tx, change, lockedTarget.where, currentUser);
        return;
      case APPROVAL_CHANGE_TARGET_TYPE.CUSTOMER:
        // sideEffects 仅在 customer 变更（当前只有 CUSTOMER_TAG_CHANGE）时消费；
        // 其他 targetType 分支静默忽略，避免前端复用同一 payload 时误报错
        await this.applyCustomerChange(tx, change, lockedTarget.where, currentUser, sideEffects);
        return;
      default:
        throw new BadRequestException(`不支持 ${change.targetType} 类型的变更申请`);
    }
  }

  private async applySaleOrderChange(
    tx: Prisma.TransactionClient,
    change: ApprovalChangeRequest,
    targetWhere: Record<string, unknown>,
    currentUser: CurrentUser
  ): Promise<void> {
    const patch = readPatch(change);
    const existing = await tx.saleOrder.findFirst({
      where: { id: change.targetId, deletedAt: null },
      include: { products: { where: { deletedAt: null } } },
    });
    if (!existing) throw new NotFoundException('合同订单不存在');
    const legacyPendingChangeTarget =
      change.eventType === 'sale_order_change' &&
      !isVoidOperation(patch) &&
      !isVoidBundleOperation(patch) &&
      targetWhere.version === change.baseVersion + 1 &&
      targetWhere.flowStatus === APPROVAL_INSTANCE_STATUS.PENDING;
    const concurrentApprovedChange =
      change.eventType === 'sale_order_change' &&
      !isVoidOperation(patch) &&
      !isVoidBundleOperation(patch) &&
      existing.version > change.baseVersion &&
      targetWhere.flowStatus === APPROVAL_INSTANCE_STATUS.APPROVED;
    if (!concurrentApprovedChange) {
      assertBaseVersion(existing.version, change.baseVersion, legacyPendingChangeTarget);
    } else {
      assertSaleOrderPatchUnchangedSinceSubmission(change, patch, existing);
    }

    if (isVoidBundleOperation(patch)) {
      await this.applySaleOrderVoidBundle(tx, existing, change, patch, targetWhere, currentUser);
      return;
    }

    if (isVoidOperation(patch)) {
      const [paymentCount, invoiceCount, project, secondaryProjectCount, manualLedgerCount] =
        await Promise.all([
          tx.payment.count({
            where: { saleOrderId: existing.id, deletedAt: null },
          }),
          tx.invoice.count({
            where: {
              saleOrderId: existing.id,
              deletedAt: null,
              OR: [
                { invoiceStatus: null },
                {
                  invoiceStatus: {
                    notIn: [INVOICE_STATUS.VOID, INVOICE_STATUS.RED_VOIDED],
                  },
                },
              ],
            },
          }),
          tx.project.findFirst({
            where: { saleOrderId: existing.id, deletedAt: null },
            select: { id: true },
          }),
          tx.projectSaleOrder.count({ where: { saleOrderId: existing.id } }),
          tx.financeLedger.count({
            where: { saleOrderId: existing.id, deletedAt: null },
          }),
        ]);
      if (
        paymentCount > 0 ||
        invoiceCount > 0 ||
        project ||
        secondaryProjectCount > 0 ||
        manualLedgerCount > 0
      ) {
        throw new BadRequestException(
          `旧版作废申请检测到关联记录已变化（回款 ${paymentCount} 笔、有效发票 ${invoiceCount} 笔、项目 ${(project ? 1 : 0) + secondaryProjectCount} 个、非派生财务流水 ${manualLedgerCount} 条），请撤回后通过“纠错作废”重新预检`
        );
      }

      await tx.saleOrder.update({
        where: targetWhere as Prisma.SaleOrderWhereUniqueInput,
        data: {
          deletedAt: new Date(),
          version: { increment: 1 },
          ...auditUpdate(currentUser),
        },
      });

      await reconcileSaleOrderActivationLifecycle(
        tx,
        {
          opportunityIds: [existing.opportunityId],
          customerIds: [existing.customerId],
          retractedOpportunityIds: [existing.opportunityId],
        },
        currentUser
      );
      await recomputeCustomerAccountsReceivable(tx, existing.customerId);
      return;
    }

    const finalCustomerId = stringFromPatch(patch, 'customerId') ?? existing.customerId;
    const finalOpportunityId = patchHas(patch, 'opportunityId')
      ? nullableStringFromPatch(patch, 'opportunityId')
      : existing.opportunityId;
    const finalChargerId = patchHas(patch, 'chargerId')
      ? nullableStringFromPatch(patch, 'chargerId')
      : existing.chargerId;
    const opportunityRelationshipChanged =
      finalCustomerId !== existing.customerId || finalOpportunityId !== existing.opportunityId;

    await this.assertSaleOrderChangeReferencesAtApply(
      tx,
      change,
      existing.id,
      existing.opportunityId,
      finalCustomerId,
      finalChargerId,
      finalOpportunityId,
      opportunityRelationshipChanged
    );

    if (patchHas(patch, 'customerId') && finalCustomerId !== existing.customerId) {
      await this.assertSaleOrderCustomerCanChange(tx, existing.id);
    }

    if (opportunityRelationshipChanged) {
      await assertSaleOrderProjectRelationUnchanged(
        tx,
        existing.id,
        finalCustomerId,
        finalOpportunityId
      );
    }

    const finalDateRange = resolveFinalSaleOrderDateRange(existing, patch);

    // data 与 customer/opportunity/charger 等 relation 操作共存 → Prisma 走 Checked
    // UpdateInput 分支，不接受裸 FK 标量 updaterEmployeeId（会报 ValidationError → 500）。
    // 审计人必须写成 updater.connect。参见 sale-orders.service.ts updateLeadStageFields。
    const audit = auditUpdate(currentUser);
    const data: Prisma.SaleOrderUpdateInput = {
      ...(audit.updaterEmployeeId
        ? { updater: { connect: { id: audit.updaterEmployeeId } } }
        : { updater: { disconnect: true } }),
      ...(legacyPendingChangeTarget ? { flowStatus: APPROVAL_INSTANCE_STATUS.APPROVED } : {}),
      version: { increment: 1 },
    };
    if (patchHas(patch, 'customerId')) data.customer = { connect: { id: finalCustomerId } };
    if (patchHas(patch, 'opportunityId')) {
      data.opportunity = finalOpportunityId
        ? { connect: { id: finalOpportunityId } }
        : { disconnect: true };
    }
    if (patchHas(patch, 'orderAmount')) data.orderAmount = decimalStringOrNull(patch.orderAmount);
    if (patchHas(patch, 'otherFee')) data.otherFee = decimalStringOrNull(patch.otherFee);
    if (patchHas(patch, 'badDebtAmount')) {
      data.badDebtAmount = decimalStringOrNull(patch.badDebtAmount) ?? '0.00';
    }
    if (patchHas(patch, 'businessDate')) data.businessDate = dateOrNull(patch.businessDate);
    if (patchHas(patch, 'paymentDate')) data.paymentDate = dateOrNull(patch.paymentDate);
    if (patchHas(patch, 'orderBeginDate')) {
      data.orderBeginDate = saleOrderDateOnlyToDate(finalDateRange.orderBeginDate);
    }
    if (patchHas(patch, 'orderEndDate')) {
      data.orderEndDate = saleOrderDateOnlyToDate(finalDateRange.orderEndDate);
    }
    if (patchHas(patch, 'chargerId')) {
      const chargerId = nullableStringFromPatch(patch, 'chargerId');
      data.charger = chargerId ? { connect: { id: chargerId } } : { disconnect: true };
    }
    if (patchHas(patch, 'remark')) data.remark = nullableStringFromPatch(patch, 'remark');

    const products = Array.isArray(patch.products) ? normalizeOrderProducts(patch.products) : null;
    if (products) {
      const productAmount = sumProductAmount(products);
      const totalReceivables = sumProductSubtotal(products);
      const totalReceived = new Prisma.Decimal(existing.totalReceived ?? 0);
      data.productAmount = productAmount.toFixed(2);
      data.totalReceivables = totalReceivables.toFixed(2);
      data.totalUncollected = Prisma.Decimal.max(
        totalReceivables.minus(totalReceived),
        new Prisma.Decimal(0)
      ).toFixed(2);
    }

    const finalOrderAmount = patchHas(patch, 'orderAmount')
      ? decimalStringOrNull(patch.orderAmount)
      : valueToString(existing.orderAmount);
    // referenceDate 传 existing.createdAt，避免审批变更回写时标题日期被推到"今天"
    data.orderTitle = await resolveOrderTitle(
      tx,
      undefined,
      finalCustomerId,
      finalOrderAmount,
      existing.createdAt
    );

    const updated = await tx.saleOrder.update({
      where: targetWhere as Prisma.SaleOrderWhereUniqueInput,
      data,
    });

    if (products) {
      await tx.orderProduct.updateMany({
        where: { saleOrderId: existing.id, deletedAt: null },
        data: { deletedAt: new Date(), ...auditUpdate(currentUser) },
      });
      await tx.orderProduct.createMany({
        data: products.map((product) => {
          const pricing = computeProductPricing(product);
          return {
            saleOrderId: existing.id,
            productName: product.productName,
            productNumber: product.productNumber ?? null,
            productPrice: product.productPrice != null ? String(product.productPrice) : null,
            quantity: product.quantity != null ? String(product.quantity) : null,
            unitPrice: product.unitPrice != null ? String(product.unitPrice) : null,
            contractUnitPrice:
              product.contractUnitPrice != null ? String(product.contractUnitPrice) : null,
            discount: pricing.discount.toFixed(2),
            subtotalAmount: pricing.subtotalAmount.toFixed(2),
            remark: product.remark ?? null,
            ...auditCreate(currentUser),
          };
        }),
      });
    }

    if (
      concurrentApprovedChange ||
      patchHas(patch, 'orderAmount') ||
      patchHas(patch, 'badDebtAmount') ||
      products
    ) {
      await recalcSaleOrderInvoicedSummary(tx, existing.id);
      await recalcSaleOrderPaymentSummary(tx, existing.id);
    } else {
      await recomputeCustomerAccountsReceivable(tx, updated.customerId);
    }
    if (existing.customerId !== updated.customerId) {
      await recomputeCustomerAccountsReceivable(tx, existing.customerId);
    }
    await advanceCustomDevelopmentProjectFromSaleOrder(
      tx,
      updated.id,
      PROJECT_STATUS.CONTRACT,
      currentUser,
      { createIfMissing: false }
    );
    if (opportunityRelationshipChanged) {
      await reconcileSaleOrderActivationLifecycle(
        tx,
        {
          opportunityIds: [existing.opportunityId, finalOpportunityId],
          customerIds: [existing.customerId, finalCustomerId],
          retractedOpportunityIds: [existing.opportunityId],
        },
        currentUser
      );
    }
  }

  private async applySaleOrderVoidBundle(
    tx: Prisma.TransactionClient,
    existing: {
      id: string;
      version: number;
      customerId: string;
      opportunityId: string | null;
    },
    change: ApprovalChangeRequest,
    patch: Patch,
    targetWhere: Record<string, unknown>,
    currentUser: CurrentUser
  ): Promise<void> {
    const lockedOrder = await tx.saleOrder.findFirst({
      where: { id: existing.id, deletedAt: null },
      select: {
        id: true,
        version: true,
        customerId: true,
        opportunityId: true,
      },
    });
    if (!lockedOrder) throw new NotFoundException('合同订单不存在');
    assertBaseVersion(lockedOrder.version, change.baseVersion);
    if (
      lockedOrder.customerId !== existing.customerId ||
      lockedOrder.opportunityId !== existing.opportunityId
    ) {
      throw new ConflictException('合同订单客户或商机关系已变化，请撤回后重新预检');
    }

    const submittedSnapshot = readVoidDependencySnapshot(patch);
    const plan = await buildSaleOrderVoidPlan(tx, existing.id);
    if (!saleOrderVoidSnapshotsEqual(plan.snapshot, submittedSnapshot)) {
      throw new ConflictException(
        '合同订单关联的回款、发票、项目或财务流水已变化，请撤回后重新预检'
      );
    }
    if (plan.preview.blockers.length > 0) {
      throw new BadRequestException(plan.preview.blockers.join('；'));
    }

    const projectAction = nullableStringFromPatch(patch, 'projectAction');
    if (
      plan.preview.requiresProjectAction &&
      projectAction !== SALE_ORDER_VOID_PROJECT_ACTION.ROLLBACK_TO_OPPORTUNITY
    ) {
      throw new BadRequestException('关联项目必须明确回退到商机阶段');
    }
    if (!plan.preview.requiresProjectAction && projectAction) {
      throw new ConflictException('关联项目状态已变化，请撤回后重新预检');
    }

    const paymentById = new Map(plan.snapshot.payments.map((payment) => [payment.id, payment]));
    const approvedPaymentIds = [...plan.approvedPaymentIds].sort((left, right) => {
      const leftDirection = paymentById.get(left)?.direction;
      const rightDirection = paymentById.get(right)?.direction;
      if (leftDirection === rightDirection) return left.localeCompare(right);
      return leftDirection === PAYMENT_DIRECTION.OUT ? -1 : 1;
    });
    const reason = nullableStringFromPatch(patch, '__reason') ?? '合同订单纠错作废';
    const now = new Date();

    for (const paymentId of approvedPaymentIds) {
      const payment = paymentById.get(paymentId);
      if (!payment) throw new ConflictException('回款依赖快照不完整，请重新发起审批');
      await tx.payment.update({
        where: { id: payment.id, version: payment.version },
        data: {
          deletedAt: now,
          version: { increment: 1 },
          ...auditUpdate(currentUser),
        },
      });
      await softDeletePaymentItemsInTransaction(tx, this.receivableService, {
        paymentIds: [payment.id],
        deletedAt: now,
        currentUser,
      });
      await this.financeLedgerSync.revokeFromPayment(tx, payment.id, `合同订单纠错作废：${reason}`);
    }

    for (const paymentId of plan.removablePaymentIds) {
      const payment = paymentById.get(paymentId);
      if (!payment) throw new ConflictException('回款依赖快照不完整，请重新发起审批');
      await tx.payment.update({
        where: { id: payment.id, version: payment.version },
        data: {
          deletedAt: now,
          version: { increment: 1 },
          ...auditUpdate(currentUser),
        },
      });
      await softDeletePaymentItemsInTransaction(tx, this.receivableService, {
        paymentIds: [payment.id],
        deletedAt: now,
        currentUser,
      });
      await this.financeLedgerSync.revokeFromPayment(tx, payment.id, `合同订单纠错作废：${reason}`);
    }

    const invoiceById = new Map(plan.snapshot.invoices.map((invoice) => [invoice.id, invoice]));
    for (const invoiceId of plan.removableInvoiceIds) {
      const invoice = invoiceById.get(invoiceId);
      if (!invoice) throw new ConflictException('发票依赖快照不完整，请重新发起审批');
      await tx.invoice.update({
        where: { id: invoice.id, version: invoice.version },
        data: {
          deletedAt: now,
          version: { increment: 1 },
          ...auditUpdate(currentUser),
        },
      });
      await clearActivePaymentInvoiceReferences(tx, invoice.id, currentUser);
    }

    if (plan.snapshot.project) {
      await tx.project.update({
        where: {
          id: plan.snapshot.project.id,
          version: plan.snapshot.project.version,
        },
        data: {
          saleOrderId: null,
          status: PROJECT_STATUS.OPPORTUNITY,
          version: { increment: 1 },
          ...auditUpdate(currentUser),
        },
      });
    }

    await tx.saleOrder.update({
      where: targetWhere as Prisma.SaleOrderWhereUniqueInput,
      data: {
        deletedAt: now,
        version: { increment: 1 },
        ...auditUpdate(currentUser),
      },
    });

    await reconcileSaleOrderActivationLifecycle(
      tx,
      {
        opportunityIds: [lockedOrder.opportunityId],
        customerIds: [lockedOrder.customerId],
        retractedOpportunityIds: [lockedOrder.opportunityId],
      },
      currentUser
    );
    await recomputeCustomerAccountsReceivable(tx, lockedOrder.customerId);
  }

  private async applyInvoiceChange(
    tx: Prisma.TransactionClient,
    change: ApprovalChangeRequest,
    targetWhere: Record<string, unknown>,
    currentUser: CurrentUser
  ): Promise<void> {
    const patch = readPatch(change);
    const existing = await tx.invoice.findFirst({
      where: { id: change.targetId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('开票记录不存在');
    assertBaseVersion(existing.version, change.baseVersion);

    const finalSaleOrderId = stringFromPatch(patch, 'saleOrderId') ?? existing.saleOrderId;
    const finalCustomerId =
      patchHas(patch, 'saleOrderId') || patchHas(patch, 'customerId')
        ? await this.resolveSaleOrderCustomerId(
            tx,
            finalSaleOrderId,
            nullableStringFromPatch(patch, 'customerId')
          )
        : existing.customerId;
    const finalInvoiceAmount = patchHas(patch, 'invoiceAmount')
      ? Number(patch.invoiceAmount)
      : Number(existing.invoiceAmount);
    const finalInvoiceStatus = patchHas(patch, 'invoiceStatus')
      ? nullableStringFromPatch(patch, 'invoiceStatus')
      : existing.invoiceStatus;

    await lockSaleOrderFinancialGraph(tx, [existing.saleOrderId, finalSaleOrderId]);
    await assertInvoiceWithinOrderAmount(tx, {
      saleOrderId: finalSaleOrderId,
      invoiceAmount: finalInvoiceAmount,
      invoiceStatus: finalInvoiceStatus,
      excludeInvoiceId: existing.id,
    });

    // relation 共存 → Checked input，审计人走 updater.connect（详见 applySaleOrderChange 注释）
    const audit = auditUpdate(currentUser);
    const data: Prisma.InvoiceUpdateInput = {
      ...(audit.updaterEmployeeId
        ? { updater: { connect: { id: audit.updaterEmployeeId } } }
        : { updater: { disconnect: true } }),
      version: { increment: 1 },
    };
    if (patchHas(patch, 'saleOrderId')) data.saleOrder = { connect: { id: finalSaleOrderId } };
    if (finalCustomerId !== existing.customerId)
      data.customer = { connect: { id: finalCustomerId } };
    if (patchHas(patch, 'invoiceAmount')) {
      data.invoiceAmount = requiredDecimalString(patch.invoiceAmount, '开票金额');
    }
    if (patchHas(patch, 'invoiceType'))
      data.invoiceType = nullableStringFromPatch(patch, 'invoiceType');
    if (patchHas(patch, 'invoiceDate')) data.invoiceDate = dateOrNull(patch.invoiceDate);
    if (patchHas(patch, 'invoiceNumber'))
      data.invoiceNumber = nullableStringFromPatch(patch, 'invoiceNumber');
    if (patchHas(patch, 'title')) data.title = nullableStringFromPatch(patch, 'title');
    if (patchHas(patch, 'taxIdentifyNum'))
      data.taxIdentifyNum = nullableStringFromPatch(patch, 'taxIdentifyNum');
    if (patchHas(patch, 'invoiceStatus'))
      data.invoiceStatus = nullableStringFromPatch(patch, 'invoiceStatus');
    if (patchHas(patch, 'itemType')) data.itemType = nullableStringFromPatch(patch, 'itemType');
    if (patchHas(patch, 'bankName')) data.bankName = nullableStringFromPatch(patch, 'bankName');
    if (patchHas(patch, 'bankAccount'))
      data.bankAccount = nullableStringFromPatch(patch, 'bankAccount');
    if (patchHas(patch, 'registeredAddress')) {
      data.registeredAddress = nullableStringFromPatch(patch, 'registeredAddress');
    }
    if (patchHas(patch, 'registeredPhone'))
      data.registeredPhone = nullableStringFromPatch(patch, 'registeredPhone');
    if (patchHas(patch, 'remark')) data.remark = nullableStringFromPatch(patch, 'remark');

    const updated = await tx.invoice.update({
      where: targetWhere as Prisma.InvoiceWhereUniqueInput,
      data,
    });

    if (
      updated.invoiceStatus === INVOICE_STATUS.VOID ||
      updated.invoiceStatus === INVOICE_STATUS.RED_VOIDED
    ) {
      await clearActivePaymentInvoiceReferences(tx, updated.id, currentUser);
    }

    await recalcSaleOrderInvoicedSummary(tx, updated.saleOrderId);
    if (existing.saleOrderId !== updated.saleOrderId) {
      await recalcSaleOrderInvoicedSummary(tx, existing.saleOrderId);
    }
  }

  private async applyPaymentChange(
    tx: Prisma.TransactionClient,
    change: ApprovalChangeRequest,
    targetWhere: Record<string, unknown>,
    currentUser: CurrentUser
  ): Promise<void> {
    const patch = readPatch(change);
    if (patchHas(patch, 'direction')) {
      throw new BadRequestException('direction 字段不可通过变更审批修改');
    }

    const existing = await tx.payment.findFirst({
      where: { id: change.targetId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('回款记录不存在');
    if (existing.legacyAdjustment) {
      throw new BadRequestException('历史负向调整为只读治理记录，禁止应用变更审批');
    }
    assertBaseVersion(existing.version, change.baseVersion);

    const hasItemsPatch = patchHas(patch, 'items');
    if (hasItemsPatch && existing.direction === PAYMENT_DIRECTION.OUT) {
      throw new BadRequestException('退款记录不支持 PaymentItem 产品拆分');
    }

    if (isVoidOperation(patch)) {
      if (existing.direction === PAYMENT_DIRECTION.IN) {
        const referencingRefunds = await tx.payment.count({
          where: {
            relatedPaymentId: existing.id,
            deletedAt: null,
            direction: PAYMENT_DIRECTION.OUT,
          },
        });
        if (referencingRefunds > 0) {
          throw new BadRequestException(
            `该回款已被 ${referencingRefunds} 笔退款引用，请先作废关联退款`
          );
        }
      }

      const deletedAt = new Date();
      await tx.payment.update({
        where: targetWhere as Prisma.PaymentWhereUniqueInput,
        data: {
          deletedAt,
          version: { increment: 1 },
          ...auditUpdate(currentUser),
        },
      });
      await softDeletePaymentItemsInTransaction(tx, this.receivableService, {
        paymentIds: [existing.id],
        deletedAt,
        currentUser,
      });
      await recalcSaleOrderPaymentSummary(tx, existing.saleOrderId);
      const reason = nullableStringFromPatch(patch, '__reason') ?? '审批通过';
      await this.financeLedgerSync.revokeFromPayment(tx, existing.id, `回款作废：${reason}`);
      return;
    }

    const finalSaleOrderId = stringFromPatch(patch, 'saleOrderId') ?? existing.saleOrderId;
    const finalPaymentAmount = patchHas(patch, 'paymentAmount')
      ? Number(patch.paymentAmount)
      : Number(existing.paymentAmount);
    const saleOrderChanged = finalSaleOrderId !== existing.saleOrderId;
    const paymentAmountChanged = finalPaymentAmount !== Number(existing.paymentAmount);
    let replacementItems: readonly PaymentItemReplacement[] | undefined;
    if (hasItemsPatch) {
      if (!Array.isArray(patch.items) || patch.items.length === 0) {
        throw new BadRequestException('回款必须提交非空的完整 PaymentItem replacement');
      }
      replacementItems = patch.items as PaymentItemReplacement[];
    }
    if (
      existing.direction === PAYMENT_DIRECTION.IN &&
      (saleOrderChanged || paymentAmountChanged) &&
      replacementItems === undefined
    ) {
      throw new BadRequestException('变更回款金额或销售订单时必须提交非空的完整 items replacement');
    }
    const finalCustomerId =
      patchHas(patch, 'saleOrderId') || patchHas(patch, 'customerId')
        ? await this.resolveSaleOrderCustomerId(
            tx,
            finalSaleOrderId,
            nullableStringFromPatch(patch, 'customerId')
          )
        : existing.customerId;

    if (existing.direction === PAYMENT_DIRECTION.OUT) {
      if (!existing.relatedPaymentId) {
        throw new BadRequestException('已通过的退款缺少 relatedPaymentId，数据异常');
      }
      await assertRefundWithinReceived(tx, {
        saleOrderId: finalSaleOrderId,
        refundAmount: finalPaymentAmount,
        relatedPaymentId: existing.relatedPaymentId,
        excludeRefundId: existing.id,
      });
    } else {
      await assertPaymentWithinReceivables(tx, {
        saleOrderId: finalSaleOrderId,
        paymentAmount: finalPaymentAmount,
        excludePaymentId: existing.id,
      });
    }

    // relation 共存 → Checked input，审计人走 updater.connect（详见 applySaleOrderChange 注释）
    const audit = auditUpdate(currentUser);
    const data: Prisma.PaymentUpdateInput = {
      ...(audit.updaterEmployeeId
        ? { updater: { connect: { id: audit.updaterEmployeeId } } }
        : { updater: { disconnect: true } }),
      version: { increment: 1 },
    };
    if (patchHas(patch, 'saleOrderId')) data.saleOrder = { connect: { id: finalSaleOrderId } };
    if (finalCustomerId !== existing.customerId)
      data.customer = { connect: { id: finalCustomerId } };
    if (patchHas(patch, 'paymentAmount'))
      data.paymentAmount = decimalStringOrNull(patch.paymentAmount) ?? '0';
    if (patchHas(patch, 'paymentType'))
      data.paymentType = nullableStringFromPatch(patch, 'paymentType');
    if (patchHas(patch, 'businessDate')) data.businessDate = dateOrNull(patch.businessDate);
    if (patchHas(patch, 'bankName')) data.bankName = nullableStringFromPatch(patch, 'bankName');
    if (patchHas(patch, 'tradeSerialNumber')) {
      data.tradeSerialNumber = nullableStringFromPatch(patch, 'tradeSerialNumber');
    }
    if (patchHas(patch, 'chargerId')) {
      const chargerId = nullableStringFromPatch(patch, 'chargerId');
      if (!chargerId) throw new BadRequestException('请选择负责人');
      data.charger = { connect: { id: chargerId } };
    }
    if (patchHas(patch, 'remark')) data.remark = nullableStringFromPatch(patch, 'remark');

    const updated = await tx.payment.update({
      where: targetWhere as Prisma.PaymentWhereUniqueInput,
      data,
    });

    if (replacementItems !== undefined) {
      await replacePaymentItemsInTransaction(tx, this.receivableService, {
        paymentId: updated.id,
        saleOrderId: updated.saleOrderId,
        paymentAmount: Number(updated.paymentAmount ?? finalPaymentAmount),
        items: replacementItems,
        currentUser,
      });
    }

    await recalcSaleOrderPaymentSummary(tx, updated.saleOrderId);
    if (existing.saleOrderId !== updated.saleOrderId) {
      await recalcSaleOrderPaymentSummary(tx, existing.saleOrderId);
    }

    if (existing.direction === PAYMENT_DIRECTION.IN) {
      await advanceCustomDevelopmentProjectFromSaleOrder(
        tx,
        updated.saleOrderId,
        PROJECT_STATUS.NOT_STARTED,
        currentUser,
        { createIfMissing: false }
      );
    }

    // CRM 回款 ↔ 财务流水绑定（v2.1）：变更审批通过同事务重写派生 ledger（开关关时 no-op）
    // 即使 saleOrderId 改变了，syncFromPayment 也会用新值重写 ledger 关键字段；
    // 旧 ledger 的 saleOrderId 字段是顺带填的，不影响业务逻辑（ledger 的源头是 paymentId）。
    await this.financeLedgerSync.syncFromPayment(tx, existing.id);
  }

  /**
   * 客户线索阶段（MQL/SQL）变更审批通过后的落地。
   *
   * - 字段白名单：仅允许 leadStage / leadStageQualifiedById；其他字段直接抛 BadRequest
   *   （防越权——审批通道不应能改客户名/负责人等其他字段）
   * - 操作人语义：leadStageUpdatedBy = 提单人（change.creatorEmployeeId，即电销自己），
   *   不是审批人（currentUser）。这样"谁打的标签"和"谁审批通过"分别可追溯
   * - 合格判定人：patch 显式传 → 用 patch 值；未传 → 默认 = 提单人
   * - 写 KeepRecord 留底：事务内 inline tx.keepRecord.create，
   *   避免引入 ApprovalsModule ↔ CustomersModule 循环依赖
   * - keepRecordType='other' + source='field_change' + 不调 refreshCustomerStatus，
   *   防止 KEEP_RECORD_TYPE_TO_CONTACT_STATUS 把 contactStatus 误标"已线上沟通"
   *
   * sideEffects.chargerId（终审指定承接销售，CUSTOMER_TAG_CHANGE 通过时必填）：
   * - 服务端强制校验，防止绕过前端直接审批造成无承接销售的终态
   * - 与 leadStage、协作人追加合并到同一次 customer.update，避免二次 version 冲突
   * - 校验员工仍存在后更新 customer.charger；协作人列表中不保留新的负责人
   * - 自动把 change.creatorEmployeeId（发起电销）union 进 collaboratorIds
   *
   * sideEffects.addCollaboratorIds 仍兼容旧版调用，并与自动追加的电销合并去重。
   */
  private async applyCustomerChange(
    tx: Prisma.TransactionClient,
    change: ApprovalChangeRequest,
    targetWhere: Record<string, unknown>,
    currentUser: CurrentUser,
    sideEffects?: ApprovalActionSideEffectsInput
  ): Promise<void> {
    const patch = readPatch(change);
    const selectedChargerId = sideEffects?.chargerId?.trim() || null;
    if (change.eventType === 'customer_tag_change' && !selectedChargerId) {
      throw new BadRequestException('终审必须指定承接销售');
    }

    const existing = await tx.customer.findFirst({
      where: { id: change.targetId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('客户不存在');
    assertBaseVersion(existing.version, change.baseVersion);

    // 字段白名单：仅允许 leadStage / leadStageQualifiedById（外加 __reason 元字段）
    const ALLOWED = new Set(['leadStage', 'leadStageQualifiedById']);
    for (const key of Object.keys(patch)) {
      if (key.startsWith('__')) continue;
      if (!ALLOWED.has(key)) {
        throw new BadRequestException(`customer 变更审批不支持字段 ${key}`);
      }
    }

    const operatorId = change.creatorEmployeeId ?? currentUser.employeeId ?? null;
    const now = new Date();

    // relation 共存（leadStageUpdatedBy/QualifiedBy）→ Checked input，审计人走 updater.connect
    const audit = auditUpdate(currentUser);
    const data: Prisma.CustomerUpdateInput = {
      ...(audit.updaterEmployeeId
        ? { updater: { connect: { id: audit.updaterEmployeeId } } }
        : { updater: { disconnect: true } }),
      version: { increment: 1 },
    };

    let selectedChargerName: string | null = null;
    if (selectedChargerId) {
      const selectedCharger = await tx.employee.findFirst({
        where: { id: selectedChargerId, deletedAt: null },
        select: { id: true, name: true },
      });
      if (!selectedCharger) {
        throw new BadRequestException('指定的承接销售不存在或已删除');
      }
      selectedChargerName = selectedCharger.name;
      data.charger = { connect: { id: selectedCharger.id } };
      data.chargerName = null;
    }

    const newLeadStage = patchHas(patch, 'leadStage')
      ? nullableStringFromPatch(patch, 'leadStage')
      : undefined;
    if (newLeadStage !== undefined) {
      data.leadStage = newLeadStage;
      data.leadStageUpdatedAt = now;
      data.leadStageUpdatedBy = operatorId ? { connect: { id: operatorId } } : { disconnect: true };
      data.leadProgressUpdatedAt = now;
      data.leadProgressUpdatedBy = operatorId
        ? { connect: { id: operatorId } }
        : { disconnect: true };
      data.leadProgressReason = null;
      if (newLeadStage === 'MQL') {
        data.leadProgressStatus = LEAD_PROGRESS_STATUS.ACTIVE;
        data.leadAppointmentAt = null;
      } else if (
        newLeadStage === 'SQL' &&
        existing.leadProgressStatus !== LEAD_PROGRESS_STATUS.VISITED &&
        existing.leadProgressStatus !== LEAD_PROGRESS_STATUS.WON
      ) {
        // 人工审批升级 SQL 没有客观预约时间，进入「待拜访/待补录时间」。
        data.leadProgressStatus = LEAD_PROGRESS_STATUS.PENDING_VISIT;
        data.leadAppointmentAt = null;
      }
      // write-once：首次进入 MQL/SQL 时戳 firstMqlAt / firstSqlAt，永不覆盖。
      // 用于 cohort 漏斗分析（"X 月首次成为 MQL 的客户里有多少升 SQL"），
      // 避免 leadStageUpdatedAt 因回归/重升被覆盖丢失"第一次"语义。
      // 参考 HubSpot "Became MQL Date" 反模式——其字段每次重升时被覆盖，cohort 报表破产。
      if (newLeadStage === 'MQL' && existing.firstMqlAt == null) {
        data.firstMqlAt = now;
      }
      if (newLeadStage === 'SQL' && existing.firstSqlAt == null) {
        data.firstSqlAt = now;
      }
    }
    const qualifiedById = patchHas(patch, 'leadStageQualifiedById')
      ? nullableStringFromPatch(patch, 'leadStageQualifiedById')
      : operatorId; // 默认 = 提单人
    if (newLeadStage !== undefined || patchHas(patch, 'leadStageQualifiedById')) {
      data.leadStageQualifiedBy = qualifiedById
        ? { connect: { id: qualifiedById } }
        : { disconnect: true };
      data.leadStageQualifiedAt = now;
    }

    // ─── 副作用：指定承接销售，并把发起电销追加为客户协作人 ───
    // 新流程由终审选择 chargerId；电销身份取自不可篡改的 change.creatorEmployeeId，
    // 不信任前端自行提交的协作人 id。addCollaboratorIds 仅保留旧版调用兼容。
    const existingCollaboratorIds =
      fromJsonValue<string[]>(existing.collaboratorIds)?.filter(
        (id): id is string => typeof id === 'string' && id.length > 0
      ) ?? [];
    const telesalesCollaboratorId =
      selectedChargerId &&
      change.creatorEmployeeId &&
      change.creatorEmployeeId !== selectedChargerId
        ? change.creatorEmployeeId
        : null;
    const legacyCollaboratorIds = sideEffects?.addCollaboratorIds ?? [];
    const requestedAddIds = Array.from(
      new Set(
        [
          ...(telesalesCollaboratorId ? [telesalesCollaboratorId] : []),
          ...legacyCollaboratorIds,
        ].filter((id): id is string => typeof id === 'string' && id.length > 0)
      )
    ).filter((id) => id !== selectedChargerId);
    // 新负责人不能同时出现在协作人列表中；先剔除负责人，再合并新增协作人。
    const collaboratorIdsWithoutCharger = selectedChargerId
      ? existingCollaboratorIds.filter((id) => id !== selectedChargerId)
      : existingCollaboratorIds;
    const actuallyAddedIds = requestedAddIds.filter(
      (id) => !collaboratorIdsWithoutCharger.includes(id)
    );
    const collaboratorIdsChanged =
      collaboratorIdsWithoutCharger.length !== existingCollaboratorIds.length ||
      actuallyAddedIds.length > 0;
    if (collaboratorIdsChanged) {
      const mergedCollaboratorIds = [...collaboratorIdsWithoutCharger, ...actuallyAddedIds];
      data.collaboratorIds = toJsonValue(mergedCollaboratorIds);
      // collaboratorName 是旧缓存字段，协作人 id 变化后必须清空，读取时动态重算。
      data.collaboratorName = null;
    }

    // 拼展示名（仅在真正追加时查一次 employee，用于 KeepRecord 内容）
    let addedNamesLine = '';
    if (actuallyAddedIds.length > 0) {
      const employees = await tx.employee.findMany({
        where: { id: { in: actuallyAddedIds } },
        select: { id: true, name: true },
      });
      const nameById = new Map(employees.map((e) => [e.id, e.name]));
      const telesalesAddedIds = telesalesCollaboratorId
        ? actuallyAddedIds.filter((id) => id === telesalesCollaboratorId)
        : [];
      const legacyAddedIds = actuallyAddedIds.filter((id) => !telesalesAddedIds.includes(id));
      const lines: string[] = [];
      if (telesalesAddedIds.length > 0) {
        lines.push(
          `电销人员一并新增协作人：${telesalesAddedIds
            .map((id) => nameById.get(id) ?? id)
            .join('、')}`
        );
      }
      if (legacyAddedIds.length > 0) {
        lines.push(
          `审批人一并新增协作人：${legacyAddedIds.map((id) => nameById.get(id) ?? id).join('、')}`
        );
      }
      addedNamesLine = lines.length > 0 ? `\n${lines.join('\n')}` : '';
    }

    await tx.customer.update({
      where: targetWhere as Prisma.CustomerWhereUniqueInput,
      data,
    });

    if (
      selectedChargerId &&
      (newLeadStage === 'MQL' || newLeadStage === 'SQL') &&
      change.approvalInstanceId
    ) {
      await tx.approvalNotificationOutbox.create({
        data: {
          dedupKey: `lead-assignment:${change.approvalInstanceId}`,
          eventType: 'lead_assignment',
          recipientEmployeeId: selectedChargerId,
          payload:
            toJsonValue({
              instanceId: change.approvalInstanceId,
              customerId: existing.id,
              customerName: existing.customerName,
              leadStage: newLeadStage,
            }) ?? Prisma.JsonNull,
        },
      });
    }

    // 写 KeepRecord 留底（inline；不调 refreshCustomerStatus 避免污染 contactStatus）
    if (newLeadStage !== undefined && existing.leadStage !== newLeadStage) {
      const from = existing.leadStage ?? null;
      const to = newLeadStage ?? null;
      const action =
        !from && to ? `打 ${to} 标签` : from && !to ? `移除 ${from} 标签` : `${from} → ${to}`;
      const reason = nullableStringFromPatch(patch, '__reason')?.trim();
      const baseContent = reason
        ? `[系统] 线索阶段变更：${action}（审批通过）\n提交备注：${reason}`
        : `[系统] 线索阶段变更：${action}（审批通过）`;
      const chargerLine = selectedChargerName ? `\n承接销售：${selectedChargerName}` : '';
      const content = `${baseContent}${chargerLine}${addedNamesLine}`;
      const chargerId = qualifiedById ?? operatorId;
      if (chargerId) {
        await tx.keepRecord.create({
          data: {
            customerId: existing.id,
            keepRecordType: 'other',
            keepRecordTime: now,
            keepRecordContent: content,
            keepRecordStatus: '客户维护',
            chargerId,
            source: KEEP_RECORD_SOURCE.FIELD_CHANGE,
            ...auditCreate(currentUser),
          },
        });
      }
    } else if (actuallyAddedIds.length > 0 && operatorId) {
      // 兜底：leadStage 没变但追加了协作人（当前 MQL/SQL 通道正常不会走到这里，
      // 因为提交入口一定带 leadStage 变化；作为防御性分支保留独立留底）
      await tx.keepRecord.create({
        data: {
          customerId: existing.id,
          keepRecordType: 'other',
          keepRecordTime: now,
          keepRecordContent: `[系统] 审批通过一并新增协作人${addedNamesLine.replace(/^\n/, '：')}`,
          keepRecordStatus: '客户维护',
          chargerId: operatorId,
          source: KEEP_RECORD_SOURCE.FIELD_CHANGE,
          ...auditCreate(currentUser),
        },
      });
    }
  }

  private async applyVisitRecordChange(
    tx: Prisma.TransactionClient,
    change: ApprovalChangeRequest,
    targetWhere: Record<string, unknown>,
    currentUser: CurrentUser
  ): Promise<void> {
    const patch = readPatch(change);
    const existing = await tx.visitRecord.findFirst({
      where: { id: change.targetId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('拜访记录不存在');
    assertBaseVersion(existing.version, change.baseVersion);

    // relation 共存 → Checked input，审计人走 updater.connect（详见 applySaleOrderChange 注释）
    const audit = auditUpdate(currentUser);
    const data: Prisma.VisitRecordUpdateInput = {
      ...(audit.updaterEmployeeId
        ? { updater: { connect: { id: audit.updaterEmployeeId } } }
        : { updater: { disconnect: true } }),
      version: { increment: 1 },
    };
    if (patchHas(patch, 'customerId'))
      data.customer = {
        connect: { id: stringFromPatch(patch, 'customerId')! },
      };
    if (patchHas(patch, 'contactId')) {
      const contactId = nullableStringFromPatch(patch, 'contactId');
      data.contact = contactId ? { connect: { id: contactId } } : { disconnect: true };
    }
    if (patchHas(patch, 'visitType')) data.visitType = nullableStringFromPatch(patch, 'visitType');
    if (patchHas(patch, 'content')) data.content = nullableStringFromPatch(patch, 'content');
    if (patchHas(patch, 'signInTime'))
      data.signInTime = parseClientDateTime(valueToString(patch.signInTime));
    if (patchHas(patch, 'signOutTime'))
      data.signOutTime = parseClientDateTime(valueToString(patch.signOutTime));
    if (patchHas(patch, 'signAddress'))
      data.signAddress = nullableStringFromPatch(patch, 'signAddress');
    if (patchHas(patch, 'signLocation'))
      data.signLocation = nullableStringFromPatch(patch, 'signLocation');
    if (patchHas(patch, 'duration')) data.duration = numberOrNull(patch.duration);
    if (patchHas(patch, 'visitStatus'))
      data.visitStatus = nullableStringFromPatch(patch, 'visitStatus');
    if (patchHas(patch, 'attachments')) {
      data.attachments = patch.attachments ? toJsonValue(patch.attachments) : Prisma.JsonNull;
    }
    if (patchHas(patch, 'chargerId')) {
      const chargerId = nullableStringFromPatch(patch, 'chargerId');
      data.charger = chargerId ? { connect: { id: chargerId } } : { disconnect: true };
    }

    const updated = await tx.visitRecord.update({
      where: targetWhere as Prisma.VisitRecordWhereUniqueInput,
      data,
    });
    await recomputeCustomerLifecycle(tx, [existing.customerId, updated.customerId], {
      syncLeadProgress: true,
      actor: currentUser,
    });
  }

  private async assertSaleOrderCustomerCanChange(
    tx: Prisma.TransactionClient,
    saleOrderId: string
  ): Promise<void> {
    const [paymentCount, invoiceCount] = await Promise.all([
      tx.payment.count({ where: { saleOrderId, deletedAt: null } }),
      tx.invoice.count({ where: { saleOrderId, deletedAt: null } }),
    ]);
    if (paymentCount > 0 || invoiceCount > 0) {
      throw new BadRequestException('合同订单已有回款或开票记录，不能修改客户');
    }
  }

  private async assertSaleOrderChangeReferencesAtApply(
    tx: Prisma.TransactionClient,
    change: ApprovalChangeRequest,
    saleOrderId: string,
    existingOpportunityId: string | null,
    customerId: string,
    chargerId: string | null,
    opportunityId: string | null,
    opportunityRelationshipChanged: boolean
  ): Promise<void> {
    const submitterEmployeeId = change.creatorEmployeeId;
    if (!submitterEmployeeId) {
      throw new BadRequestException('变更申请缺少可验证的发起员工，拒绝落地');
    }

    const submitter = await tx.employee.findFirst({
      where: { id: submitterEmployeeId, deletedAt: null },
      select: { id: true },
    });
    if (!submitter) {
      throw new BadRequestException('变更申请发起员工不存在或已删除，拒绝落地');
    }

    // 与 DataScopeService 的实时语义一致：任一有效角色为 ALL 则不限，否则收敛到 SELF。
    // 必须在落地事务内重新解析，而不是信任提单时可伪造或已过期的 scope 快照。
    const permissions = await tx.rolePermission.findMany({
      where: {
        module: 'crm',
        menu: 'sale_orders',
        role: {
          deletedAt: null,
          status: 'active',
          users: { some: { employeeId: submitterEmployeeId } },
        },
      },
      select: { viewScope: true },
    });
    const chargerScope = permissions.some((permission) => permission.viewScope === 'ALL')
      ? null
      : [submitterEmployeeId];

    const customerWhere: Prisma.CustomerWhereInput = {
      id: customerId,
      deletedAt: null,
    };
    applyCustomerCollabSelfScope(customerWhere, chargerScope, submitterEmployeeId);
    const customer = await tx.customer.findFirst({
      where: customerWhere,
      select: { id: true },
    });
    if (!customer) {
      throw new BadRequestException('最终客户不存在、已删除或已超出发起人的可写数据范围');
    }

    if (!chargerId) {
      throw new BadRequestException('合同订单最终负责人不能为空，拒绝落地');
    }
    const charger = await tx.employee.findFirst({
      where: {
        id: chargerScope === null ? chargerId : { equals: chargerId, in: chargerScope },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!charger) {
      throw new BadRequestException('最终负责人不存在、已删除或已超出发起人的数据范围');
    }

    if (opportunityRelationshipChanged) {
      await lockSaleOrderRelationshipsBeforeCustomerTouch(
        tx,
        [{ saleOrderId, opportunityId: existingOpportunityId, customerId }],
        { opportunityIds: [opportunityId], customerIds: [customerId] }
      );
    }

    if (!opportunityId) return;
    const opportunityWhere: Prisma.OpportunityWhereInput = {
      id: opportunityId,
      customerId,
      deletedAt: null,
    };
    applyCustomerCollabViaCustomerScope(opportunityWhere, chargerScope, submitterEmployeeId);
    const opportunity = await tx.opportunity.findFirst({
      where: opportunityWhere,
      select: { id: true },
    });
    if (!opportunity) {
      throw new BadRequestException(
        '最终商机不存在、已删除、超出发起人的可见范围，或与最终客户不一致'
      );
    }

    // 仅新建/改绑/客户关系变化会形成新的占用事实；普通字段变更兼容历史多订单。
    if (opportunityRelationshipChanged) {
      await assertOpportunityHasNoActiveSaleOrder(tx, opportunityId, saleOrderId);
    }
  }

  private async resolveSaleOrderCustomerId(
    tx: Prisma.TransactionClient,
    saleOrderId: string,
    providedCustomerId?: string | null
  ): Promise<string> {
    const order = await tx.saleOrder.findFirst({
      where: { id: saleOrderId, deletedAt: null },
      select: { customerId: true },
    });
    if (!order) throw new BadRequestException(`销售订单 ${saleOrderId} 不存在或已删除`);
    if (providedCustomerId && providedCustomerId !== order.customerId) {
      throw new BadRequestException('客户必须与销售订单所属客户一致');
    }
    return order.customerId;
  }
}

function hasPrismaErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

function isApprovalChangeTargetType(value: string): value is ApprovalChangeTargetType {
  return Object.values(APPROVAL_CHANGE_TARGET_TYPE).includes(value as ApprovalChangeTargetType);
}

function readPatch(change: ApprovalChangeRequest): Patch {
  return fromJsonValue<Patch>(change.patch) ?? {};
}

function isVoidOperation(patch: Patch): boolean {
  return patch.__operation === VOID_OPERATION;
}

function isVoidBundleOperation(patch: Patch): boolean {
  return patch.__operation === VOID_BUNDLE_OPERATION;
}

function readVoidDependencySnapshot(patch: Patch): SaleOrderVoidDependencySnapshot {
  const snapshot = patch.dependencySnapshot;
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
    throw new BadRequestException('纠错作废申请缺少有效的依赖快照，请撤回后重新发起');
  }
  return snapshot as unknown as SaleOrderVoidDependencySnapshot;
}

const SALE_ORDER_CHANGE_FIELD_LABELS: Record<string, string> = {
  customerId: '客户',
  opportunityId: '商机',
  chargerId: '负责人',
  orderAmount: '合同金额',
  otherFee: '其他费用',
  badDebtAmount: '坏账金额',
  businessDate: '业务日期',
  paymentDate: '约定回款日期',
  orderBeginDate: '合同开始日期',
  orderEndDate: '合同结束日期',
  remark: '备注',
  products: '产品明细',
};

function assertSaleOrderPatchUnchangedSinceSubmission(
  change: ApprovalChangeRequest,
  patch: Patch,
  current: Record<string, unknown>
): void {
  const before = fromJsonValue<Patch>(change.beforeSnapshot);
  if (!before) {
    throw new ConflictException('订单变更审批缺少提交时快照，无法判断字段冲突；请撤回后重新发起');
  }

  const conflicts = Object.keys(patch)
    .filter((field) => field in SALE_ORDER_CHANGE_FIELD_LABELS)
    .filter((field) => !saleOrderChangeValuesEqual(field, before[field], current[field]))
    .map(
      (field) =>
        `${SALE_ORDER_CHANGE_FIELD_LABELS[field]}（当前：${formatSaleOrderChangeValue(
          field,
          current[field]
        )}）`
    );

  if (conflicts.length > 0) {
    throw new ConflictException(
      `订单变更审批存在字段冲突：${conflicts.join('、')}。请按当前内容核对后撤回并重新提交变更审批`
    );
  }
}

function saleOrderChangeValuesEqual(field: string, before: unknown, current: unknown): boolean {
  return formatSaleOrderChangeValue(field, before) === formatSaleOrderChangeValue(field, current);
}

function formatSaleOrderChangeValue(field: string, value: unknown): string {
  if (field === 'products') {
    const products = Array.isArray(value) ? value : [];
    return JSON.stringify(
      products
        .map((product) => {
          const item = product as Record<string, unknown>;
          return {
            productName: nullableText(item.productName),
            productNumber: nullableText(item.productNumber),
            productPrice: decimalText(item.productPrice),
            quantity: decimalText(item.quantity),
            unitPrice: decimalText(item.unitPrice),
            contractUnitPrice: decimalText(item.contractUnitPrice),
            remark: nullableText(item.remark),
          };
        })
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
    );
  }
  if (['orderAmount', 'otherFee', 'badDebtAmount'].includes(field)) {
    return decimalText(value);
  }
  if (['businessDate', 'paymentDate', 'orderBeginDate', 'orderEndDate'].includes(field)) {
    return value == null ? '' : String(value).slice(0, 10);
  }
  return nullableText(value);
}

function decimalText(value: unknown): string {
  if (value == null || value === '') return '';
  return new Prisma.Decimal(value as Prisma.Decimal.Value).toString();
}

function nullableText(value: unknown): string {
  return value == null ? '' : String(value);
}

function assertBaseVersion(
  currentVersion: number,
  baseVersion: number,
  allowLegacyPendingChangeTarget = false
): void {
  if (
    currentVersion !== baseVersion &&
    !(allowLegacyPendingChangeTarget && currentVersion === baseVersion + 1)
  ) {
    throw new ConflictException(
      `原单已在变更申请提交后被修改（当前版本 ${currentVersion}，申请基准版本 ${baseVersion}），请撤回后重新发起变更审批`
    );
  }
}

/** 判断审批 patch 是否显式提供字段，保留 null 作为有效变更值。 */
function patchHas(patch: Patch, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(patch, key);
}

function stringFromPatch(patch: Patch, key: string): string | undefined {
  const value = patch[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function nullableStringFromPatch(patch: Patch, key: string): string | null {
  const value = patch[key];
  if (value === null || value === undefined || value === '') return null;
  return typeof value === 'string' ? value : String(value);
}

function decimalStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function requiredDecimalString(value: unknown, label: string): string {
  const decimal = decimalStringOrNull(value);
  if (decimal == null) {
    throw new BadRequestException(`${label}不能为空`);
  }
  return decimal;
}

function resolveFinalSaleOrderDateRange(
  existing: {
    orderBeginDate?: Date | string | null;
    orderEndDate?: Date | string | null;
  },
  patch: Patch
): { orderBeginDate: string | null; orderEndDate: string | null } {
  const beginPatched = patchHas(patch, 'orderBeginDate');
  const endPatched = patchHas(patch, 'orderEndDate');
  const dateRangePatched = beginPatched || endPatched;
  const orderBeginDate = normalizeSaleOrderDateOnly(
    beginPatched ? patch.orderBeginDate : existing.orderBeginDate,
    '合同开始日期',
    dateRangePatched
  );
  const orderEndDate = normalizeSaleOrderDateOnly(
    endPatched ? patch.orderEndDate : existing.orderEndDate,
    '合同结束日期',
    false
  );

  if (orderBeginDate && orderEndDate && orderEndDate < orderBeginDate) {
    throw new BadRequestException('合同结束日期不能早于合同开始日期');
  }
  return { orderBeginDate, orderEndDate };
}

function normalizeSaleOrderDateOnly(
  value: unknown,
  label: string,
  required: boolean
): string | null {
  if (value === null || value === undefined || value === '') {
    if (required) throw new BadRequestException(`${label}必须是有效的 YYYY-MM-DD 日历日期`);
    return null;
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new BadRequestException(`${label}必须是有效的 YYYY-MM-DD 日历日期`);
    }
    return value.toISOString().slice(0, 10);
  }

  const parsed = saleOrderDateOnlySchema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException(`${label}必须是有效的 YYYY-MM-DD 日历日期`);
  }
  return parsed.data;
}

function saleOrderDateOnlyToDate(value: string | null): Date | null {
  return value === null ? null : new Date(`${value}T00:00:00.000Z`);
}

function dateOrNull(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function valueToString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

type OrderProductPatch = {
  productName: string;
  productNumber?: string | null;
  productPrice?: number | string | null;
  quantity?: number | string | null;
  unitPrice?: number | string | null;
  contractUnitPrice?: number | string | null;
  remark?: string | null;
};

function normalizeOrderProducts(value: unknown[]): OrderProductPatch[] {
  if (value.length === 0) {
    throw new BadRequestException('合同订单至少需要一项产品明细');
  }
  return value.map((item) => {
    if (typeof item !== 'object' || item === null) {
      throw new BadRequestException('产品明细格式不正确');
    }
    const record = item as Record<string, unknown>;
    const productName = typeof record.productName === 'string' ? record.productName.trim() : '';
    if (!productName) throw new BadRequestException('产品名称不能为空');
    return {
      productName,
      productNumber: record.productNumber == null ? null : String(record.productNumber),
      productPrice: record.productPrice as number | string | null | undefined,
      quantity: record.quantity as number | string | null | undefined,
      unitPrice: record.unitPrice as number | string | null | undefined,
      contractUnitPrice: record.contractUnitPrice as number | string | null | undefined,
      remark: record.remark == null ? null : String(record.remark),
    };
  });
}

function computeProductPricing(product: OrderProductPatch): {
  discount: Prisma.Decimal;
  productAmount: Prisma.Decimal;
  subtotalAmount: Prisma.Decimal;
} {
  if (product.quantity == null || product.unitPrice == null || product.contractUnitPrice == null) {
    throw new BadRequestException(
      `产品「${product.productName ?? ''}」必须填写数量、产品单价和合同单价`
    );
  }
  const qty = new Prisma.Decimal(product.quantity);
  const unitPrice = new Prisma.Decimal(product.unitPrice);
  const contractUnitPrice = new Prisma.Decimal(product.contractUnitPrice);
  if (qty.lte(0) || unitPrice.lte(0) || contractUnitPrice.lte(0)) {
    throw new BadRequestException(
      `产品「${product.productName ?? ''}」数量、产品单价和合同单价必须大于 0`
    );
  }
  const discount = new Prisma.Decimal(1)
    .minus(contractUnitPrice.div(unitPrice))
    .mul(100)
    .toDecimalPlaces(2);
  if (discount.lt(-999.99) || discount.gt(100)) {
    throw new BadRequestException(
      `产品「${product.productName ?? ''}」折扣超出范围，请核对产品单价和合同单价`
    );
  }
  return {
    discount,
    productAmount: qty.mul(unitPrice).toDecimalPlaces(2),
    subtotalAmount: qty.mul(contractUnitPrice).toDecimalPlaces(2),
  };
}

function sumProductAmount(products: OrderProductPatch[]): Prisma.Decimal {
  return products.reduce(
    (sum, product) => sum.plus(computeProductPricing(product).productAmount),
    new Prisma.Decimal(0)
  );
}

function sumProductSubtotal(products: OrderProductPatch[]): Prisma.Decimal {
  return products.reduce(
    (sum, product) => sum.plus(computeProductPricing(product).subtotalAmount),
    new Prisma.Decimal(0)
  );
}
