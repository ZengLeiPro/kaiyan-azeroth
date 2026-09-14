import { APPROVAL_EVENT_TYPE } from '@ky-azeroth/shared/constants';

import { buildApprovalTitle, getApprovalFormCode } from './approval-title.helper';

export type ApprovalBusinessModelName = 'invoice' | 'payment' | 'visitRecord' | 'saleOrder';

export interface ApprovalBusinessConfig {
  modelName: ApprovalBusinessModelName;
  notFoundMessage: string;
  buildFormCode: (record: Record<string, unknown>) => string;
  buildTitle: (record: Record<string, unknown>) => string;
}

export const APPROVAL_BUSINESS_REGISTRY = {
  [APPROVAL_EVENT_TYPE.INVOICE_APPROVE]: {
    modelName: 'invoice',
    notFoundMessage: '开票记录不存在',
    buildFormCode: getApprovalFormCode,
    buildTitle: (record) => buildApprovalTitle(APPROVAL_EVENT_TYPE.INVOICE_APPROVE, record),
  },
  [APPROVAL_EVENT_TYPE.PAYMENT_APPROVE]: {
    modelName: 'payment',
    notFoundMessage: '回款记录不存在',
    buildFormCode: getApprovalFormCode,
    buildTitle: (record) => buildApprovalTitle(APPROVAL_EVENT_TYPE.PAYMENT_APPROVE, record),
  },
  [APPROVAL_EVENT_TYPE.PAYMENT_REFUND_APPROVE]: {
    // 共用 payment 表（direction='OUT'），但 title 用"退款审批"语义
    modelName: 'payment',
    notFoundMessage: '退款记录不存在',
    buildFormCode: getApprovalFormCode,
    buildTitle: (record) => buildApprovalTitle(APPROVAL_EVENT_TYPE.PAYMENT_REFUND_APPROVE, record),
  },
  [APPROVAL_EVENT_TYPE.VISIT_APPROVE]: {
    modelName: 'visitRecord',
    notFoundMessage: '拜访记录不存在',
    buildFormCode: getApprovalFormCode,
    buildTitle: (record) => buildApprovalTitle(APPROVAL_EVENT_TYPE.VISIT_APPROVE, record),
  },
  [APPROVAL_EVENT_TYPE.SALE_ORDER_ACTIVATE]: {
    modelName: 'saleOrder',
    notFoundMessage: '合同订单不存在',
    buildFormCode: getApprovalFormCode,
    buildTitle: (record) => buildApprovalTitle(APPROVAL_EVENT_TYPE.SALE_ORDER_ACTIVATE, record),
  },
} satisfies Record<string, ApprovalBusinessConfig>;

export type ApprovalBusinessEventType = keyof typeof APPROVAL_BUSINESS_REGISTRY;

export function getApprovalBusinessConfig(eventType: string): ApprovalBusinessConfig | undefined {
  return APPROVAL_BUSINESS_REGISTRY[eventType as ApprovalBusinessEventType];
}
