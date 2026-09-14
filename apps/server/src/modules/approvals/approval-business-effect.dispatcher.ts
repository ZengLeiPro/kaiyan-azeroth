import { APPROVAL_INSTANCE_STATUS, PROJECT_STATUS } from '@ky-azeroth/shared/constants';
import type { ApprovalActionSideEffectsInput } from '@ky-azeroth/shared/schemas/approval';
import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { auditUpdate } from '../../common/utils/audit-helper';
import { recomputeCustomerLifecycle } from '../customers/customer-lifecycle';
import { OrderProductReceivableService } from '../finance/receivables/order-product-receivable.service';
import { FinanceLedgerSyncService } from '../finance/sync/finance-ledger-sync.service';
import { clearActivePaymentInvoiceReferences } from '../invoices/payment-invoice-reference.helper';
import { advanceCustomDevelopmentProjectFromSaleOrder } from '../projects/project-lifecycle.helper';
import {
  assertInvoiceWithinOrderAmount,
  assertPaymentWithinReceivables,
  assertRefundWithinReceived,
  lockSaleOrderFinancialGraph,
} from '../sale-orders/financial-limits.helper';
import { recalcSaleOrderInvoicedSummary } from '../sale-orders/invoiced-summary.helper';
import { recalcSaleOrderPaymentSummary } from '../sale-orders/payment-summary.helper';
import { reconcileSaleOrderActivationLifecycle } from '../sale-orders/sale-order-activation-lifecycle.helper';
import { ApprovalChangeRequestsService } from './approval-change-requests.service';
import { lockAndValidatePendingApprovalTarget } from './approval-target-validator.helper';

type CurrentUser = { id: string; employeeId?: string | null };

@Injectable()
export class ApprovalBusinessEffectDispatcher {
  private readonly logger = new Logger(ApprovalBusinessEffectDispatcher.name);

  constructor(
    private readonly approvalChangeRequests: ApprovalChangeRequestsService,
    private readonly financeLedgerSync: FinanceLedgerSyncService,
    private readonly orderProductReceivableService: OrderProductReceivableService
  ) {}
  async dispatchResult(
    tx: Prisma.TransactionClient,
    eventType: string,
    formId: string,
    targetVersion: number | null,
    initiatorEmployeeId: string | null,
    status: 'approved' | 'rejected',
    currentUser: CurrentUser,
    sideEffects?: ApprovalActionSideEffectsInput
  ) {
    const handledChangeRequest = await this.approvalChangeRequests.handleApprovalResult(
      tx,
      eventType,
      formId,
      targetVersion,
      status,
      currentUser,
      sideEffects
    );
    if (handledChangeRequest) return;
    if (targetVersion == null) {
      throw new ConflictException('旧审批缺少业务目标版本快照，请撤回后重新发起');
    }
    await lockAndValidatePendingApprovalTarget(tx, {
      eventType,
      formId,
      targetVersion,
      initiatorEmployeeId,
    });

    const flowStatus = status === 'approved' ? 'approved' : 'rejected';

    switch (eventType) {
      case 'sale_order_activate': {
        const saleOrder = await tx.saleOrder.update({
          where: {
            id: formId,
            version: targetVersion,
            flowStatus: APPROVAL_INSTANCE_STATUS.PENDING,
            deletedAt: null,
          },
          data: {
            flowStatus,
            version: { increment: 1 },
            ...auditUpdate(currentUser),
          },
          select: { customerId: true, opportunityId: true },
        });
        if (status === 'approved') {
          await advanceCustomDevelopmentProjectFromSaleOrder(
            tx,
            formId,
            PROJECT_STATUS.CONTRACT,
            currentUser,
            { createIfMissing: true }
          );
        }
        await reconcileSaleOrderActivationLifecycle(
          tx,
          {
            opportunityIds: [saleOrder.opportunityId],
            customerIds: [saleOrder.customerId],
          },
          currentUser
        );
        break;
      }
      case 'invoice_approve': {
        const existingInvoice = await tx.invoice.findUnique({
          where: { id: formId },
          select: { saleOrderId: true, invoiceAmount: true, invoiceStatus: true },
        });
        if (!existingInvoice) {
          throw new BadRequestException('开票记录不存在');
        }
        if (status === 'approved') {
          await lockSaleOrderFinancialGraph(tx, existingInvoice.saleOrderId);
          await assertInvoiceWithinOrderAmount(tx, {
            saleOrderId: existingInvoice.saleOrderId,
            invoiceAmount: existingInvoice.invoiceAmount,
            invoiceStatus: existingInvoice.invoiceStatus,
            excludeInvoiceId: formId,
          });
        }

        const invoice = await tx.invoice.update({
          where: {
            id: formId,
            version: targetVersion,
            flowStatus: APPROVAL_INSTANCE_STATUS.PENDING,
            deletedAt: null,
          },
          data: {
            flowStatus,
            version: { increment: 1 },
            ...auditUpdate(currentUser),
          },
          select: { saleOrderId: true },
        });
        // 合并开票：审批被驳回时清理回款的反向引用，避免脏状态
        //（发票仍存在但已被否决，关联回款应当解除合并标记以便重新选）
        if (status === 'rejected') {
          await clearActivePaymentInvoiceReferences(tx, formId, currentUser);
        }
        // 审批通过/驳回都会改变"approved 发票总和"，必须重算订单的开票聚合
        await recalcSaleOrderInvoicedSummary(tx, invoice.saleOrderId);
        break;
      }
      case 'payment_approve': {
        const existingPayment = await tx.payment.findUnique({
          where: { id: formId },
          select: { saleOrderId: true, paymentAmount: true, legacyAdjustment: true },
        });
        if (!existingPayment) {
          throw new BadRequestException('回款记录不存在');
        }
        if (existingPayment.legacyAdjustment) {
          throw new BadRequestException('历史负向调整为只读治理记录，禁止审批回写');
        }
        if (status === 'approved') {
          await lockSaleOrderFinancialGraph(tx, existingPayment.saleOrderId);
          await assertPaymentWithinReceivables(tx, {
            saleOrderId: existingPayment.saleOrderId,
            paymentAmount: existingPayment.paymentAmount,
            excludePaymentId: formId,
          });
        }

        const payment = await tx.payment.update({
          where: {
            id: formId,
            version: targetVersion,
            flowStatus: APPROVAL_INSTANCE_STATUS.PENDING,
            deletedAt: null,
            legacyAdjustment: false,
          },
          data: {
            flowStatus,
            version: { increment: 1 },
            ...auditUpdate(currentUser),
          },
          select: { saleOrderId: true },
        });
        if (status === 'approved') {
          await this.orderProductReceivableService.recalculateForPayment(tx, formId);
        }
        // 审批通过/驳回都会改变"approved 回款总和"，必须重算订单的收款聚合
        await recalcSaleOrderPaymentSummary(tx, payment.saleOrderId);
        if (status === 'approved') {
          await advanceCustomDevelopmentProjectFromSaleOrder(
            tx,
            payment.saleOrderId,
            PROJECT_STATUS.NOT_STARTED,
            currentUser,
            { createIfMissing: false }
          );
        }
        // CRM 回款 ↔ 财务流水绑定（v2.1）：审批通过同事务写派生 ledger（开关关时 no-op）
        if (status === 'approved') {
          await this.financeLedgerSync.syncFromPayment(tx, formId);
        }
        break;
      }
      case 'payment_refund_approve': {
        const existingRefund = await tx.payment.findUnique({
          where: { id: formId },
          select: {
            saleOrderId: true,
            paymentAmount: true,
            direction: true,
            relatedPaymentId: true,
            legacyAdjustment: true,
          },
        });
        if (!existingRefund) {
          throw new BadRequestException('退款记录不存在');
        }
        if (existingRefund.legacyAdjustment) {
          throw new BadRequestException('历史负向调整为只读治理记录，禁止审批回写');
        }
        if (status === 'approved') {
          if (!existingRefund.relatedPaymentId) {
            throw new BadRequestException('退款记录缺少 relatedPaymentId，无法审批通过');
          }

          // 完整 SaleOrder 图已按 Payment id 锁住同订单全部 IN/OUT，
          // 无需篡改关联原回款 version 即可串行化余额聚合。
          await assertRefundWithinReceived(tx, {
            saleOrderId: existingRefund.saleOrderId,
            refundAmount: existingRefund.paymentAmount,
            relatedPaymentId: existingRefund.relatedPaymentId,
            excludeRefundId: formId,
          });
        }

        const refund = await tx.payment.update({
          where: {
            id: formId,
            version: targetVersion,
            flowStatus: APPROVAL_INSTANCE_STATUS.PENDING,
            deletedAt: null,
            legacyAdjustment: false,
          },
          data: {
            flowStatus,
            version: { increment: 1 },
            ...auditUpdate(currentUser),
          },
          select: { saleOrderId: true },
        });
        // 审批通过/驳回会改变 OUT 总额，影响净收 / 已退 / orderStatus，必须重算
        await recalcSaleOrderPaymentSummary(tx, refund.saleOrderId);
        // CRM 回款 ↔ 财务流水绑定（v2.1）：退款审批通过同事务写派生 ledger（amount 负向）
        if (status === 'approved') {
          await this.financeLedgerSync.syncFromPayment(tx, formId);
        }
        break;
      }
      case 'visit_approve': {
        const visit = await tx.visitRecord.update({
          where: {
            id: formId,
            version: targetVersion,
            flowStatus: APPROVAL_INSTANCE_STATUS.PENDING,
            deletedAt: null,
          },
          data: {
            flowStatus,
            version: { increment: 1 },
            ...auditUpdate(currentUser),
          },
          select: { customerId: true },
        });
        await recomputeCustomerLifecycle(tx, visit.customerId, {
          syncLeadProgress: true,
          actor: currentUser,
        });
        break;
      }
      case 'project_launch':
        await tx.project.update({
          where: {
            id: formId,
            version: targetVersion,
            flowStatus: APPROVAL_INSTANCE_STATUS.PENDING,
            deletedAt: null,
          },
          data: {
            flowStatus,
            version: { increment: 1 },
            ...auditUpdate(currentUser),
          },
        });
        break;
      default:
        this.logger.warn(`审批状态回写：eventType=${eventType} 暂未配置业务表更新逻辑`);
    }
  }
  async dispatchWithdraw(
    tx: Prisma.TransactionClient,
    eventType: string,
    formId: string,
    targetVersion: number | null,
    initiatorEmployeeId: string | null,
    currentUser: CurrentUser
  ) {
    const handledChangeRequest = await this.approvalChangeRequests.handleWithdraw(
      tx,
      eventType,
      formId,
      targetVersion,
      currentUser
    );
    if (handledChangeRequest) return;
    if (targetVersion == null) {
      throw new ConflictException('旧审批缺少业务目标版本快照，请撤回后重新发起');
    }
    await lockAndValidatePendingApprovalTarget(tx, {
      eventType,
      formId,
      targetVersion,
      initiatorEmployeeId,
    });

    switch (eventType) {
      case 'sale_order_activate': {
        const saleOrder = await tx.saleOrder.update({
          where: {
            id: formId,
            version: targetVersion,
            flowStatus: APPROVAL_INSTANCE_STATUS.PENDING,
            deletedAt: null,
          },
          data: {
            flowStatus: 'draft',
            version: { increment: 1 },
            ...auditUpdate(currentUser),
          },
          select: { customerId: true, opportunityId: true },
        });
        await reconcileSaleOrderActivationLifecycle(
          tx,
          {
            opportunityIds: [saleOrder.opportunityId],
            customerIds: [saleOrder.customerId],
          },
          currentUser
        );
        break;
      }
      case 'invoice_approve': {
        const invoice = await tx.invoice.update({
          where: {
            id: formId,
            version: targetVersion,
            flowStatus: APPROVAL_INSTANCE_STATUS.PENDING,
            deletedAt: null,
          },
          data: {
            flowStatus: 'draft',
            version: { increment: 1 },
            ...auditUpdate(currentUser),
          },
          select: { saleOrderId: true },
        });
        // 合并开票：撤回审批时清理回款的反向引用，避免脏状态
        // （发票回到 draft 状态后调用方可改可删，关联回款不应继续标记"已合并"）
        await clearActivePaymentInvoiceReferences(tx, formId, currentUser);
        // 撤回会让原本 approved 的发票回退为 draft，订单聚合需要重算
        await recalcSaleOrderInvoicedSummary(tx, invoice.saleOrderId);
        break;
      }
      case 'payment_approve': {
        const payment = await tx.payment.update({
          where: {
            id: formId,
            version: targetVersion,
            flowStatus: APPROVAL_INSTANCE_STATUS.PENDING,
            deletedAt: null,
            legacyAdjustment: false,
          },
          data: {
            flowStatus: 'draft',
            version: { increment: 1 },
            ...auditUpdate(currentUser),
          },
          select: { saleOrderId: true },
        });
        // 撤回会让原本 approved 的回款回退为 draft，订单聚合需要重算
        await recalcSaleOrderPaymentSummary(tx, payment.saleOrderId);
        // CRM 回款 ↔ 财务流水绑定（v2.1）：撤回同事务软删派生 ledger（开关关时 no-op）
        await this.financeLedgerSync.revokeFromPayment(tx, formId, '回款审批撤回');
        break;
      }
      case 'payment_refund_approve': {
        const refund = await tx.payment.update({
          where: {
            id: formId,
            version: targetVersion,
            flowStatus: APPROVAL_INSTANCE_STATUS.PENDING,
            deletedAt: null,
            legacyAdjustment: false,
          },
          data: {
            flowStatus: 'draft',
            version: { increment: 1 },
            ...auditUpdate(currentUser),
          },
          select: { saleOrderId: true },
        });
        // 撤回退款审批：OUT 总额变化，订单聚合（含 orderStatus）必须重算
        await recalcSaleOrderPaymentSummary(tx, refund.saleOrderId);
        // CRM 回款 ↔ 财务流水绑定（v2.1）：撤回退款同事务软删派生 ledger
        await this.financeLedgerSync.revokeFromPayment(tx, formId, '退款审批撤回');
        break;
      }
      case 'visit_approve': {
        const visit = await tx.visitRecord.update({
          where: {
            id: formId,
            version: targetVersion,
            flowStatus: APPROVAL_INSTANCE_STATUS.PENDING,
            deletedAt: null,
          },
          data: {
            flowStatus: 'draft',
            version: { increment: 1 },
            ...auditUpdate(currentUser),
          },
          select: { customerId: true },
        });
        await recomputeCustomerLifecycle(tx, visit.customerId, {
          syncLeadProgress: true,
          actor: currentUser,
        });
        break;
      }
      case 'project_launch':
        await tx.project.update({
          where: {
            id: formId,
            version: targetVersion,
            flowStatus: APPROVAL_INSTANCE_STATUS.PENDING,
            deletedAt: null,
          },
          data: {
            flowStatus: 'draft',
            version: { increment: 1 },
            ...auditUpdate(currentUser),
          },
        });
        break;
      default:
        this.logger.warn(`审批撤回状态回写：eventType=${eventType} 暂未配置业务表更新逻辑`);
    }
  }
}
