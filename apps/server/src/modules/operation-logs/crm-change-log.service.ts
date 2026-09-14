import { Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

import { OperationLogsService } from './operation-logs.service';

type AuditUser = { id: string; employeeId?: string | null };
type JsonRecord = Record<string, unknown>;

export interface CrmChangeLogOptions {
  module: string;
  action: string;
  target: string;
  targetName?: string | null;
  currentUser: AuditUser | null | undefined;
  before?: unknown;
  after?: unknown;
}

export interface CrmFieldChange {
  field: string;
  label: string;
  before: unknown;
  after: unknown;
}

const SYSTEM_FIELDS = new Set([
  'id',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'createdBy',
  'updatedBy',
  'creatorEmployeeId',
  'updaterEmployeeId',
  'version',
  'creatorEmployee',
  'updaterEmployee',
]);

const RELATION_FIELDS = new Set([
  'customer',
  'customers',
  'contact',
  'contacts',
  'charger',
  'chargerName',
  'collaboratorName',
  'creator',
  'updater',
  'saleOrder',
  'saleOrders',
  'opportunity',
  'opportunities',
  'payments',
  'invoices',
  'keepRecords',
  'visitRecords',
  'projects',
  'relatedPayment',
]);

const FIELD_LABELS: Record<string, Record<string, string>> = {
  customers: {
    serialNumber: '客户编号',
    customerName: '客户名称',
    shortName: '客户简称',
    customerType: '客户类型',
    customerLevel: '客户等级',
    customerSource: '客户来源',
    customerRelationship: '客户关系',
    customerTags: '客户标签',
    industry: '所属行业',
    country: '国家',
    province: '省份',
    city: '城市',
    district: '区县',
    address: '地址',
    chargerId: '负责人',
    collaboratorName: '协作人',
    collaboratorIds: '协作人',
    organizationId: '组织 ID',
    uncId: '统一社会信用代码',
    headcountRange: '人员规模',
    contactStatus: '跟进状态',
    dealStatus: '成交状态',
    leadStage: '线索阶段',
    leadStageUpdatedAt: '线索阶段更新时间',
    leadStageUpdatedById: '线索阶段操作人',
    leadStageQualifiedById: '合格判定人',
    leadStageQualifiedAt: '合格判定时间',
    leadProgressStatus: '线索推进状态',
    leadAppointmentAt: '预约拜访时间',
    leadProgressReason: '推进原因',
    leadProgressUpdatedAt: '推进状态更新时间',
    leadProgressUpdatedById: '推进状态操作人',
    remark: '备注',
    aiInfoSummary: 'AI 信息摘要',
  },
  contacts: {
    customerId: '所属客户',
    contactName: '联系人姓名',
    position: '职位',
    department: '部门',
    mobile: '手机',
    phone: '电话',
    email: '邮箱',
    wechat: '微信',
    isPrimary: '主要联系人',
    remark: '备注',
  },
  opportunities: {
    customerId: '客户',
    contactId: '联系人',
    opportunityName: '商机名称',
    opportunityStage: '商机阶段',
    opportunityAmount: '商机金额',
    winRate: '赢率',
    expectedDealDate: '预计成交日期',
    realDealDate: '实际成交日期',
    lostDate: '输单日期',
    loseReason: '输单原因',
    loseReasonDetail: '输单说明',
    chargerId: '负责人',
    products: '产品明细',
    remark: '备注',
  },
  'sale-orders': {
    customerId: '客户',
    opportunityId: '商机',
    orderTitle: '合同标题',
    orderAmount: '合同金额',
    otherFee: '其他相关费用',
    businessDate: '业务日期',
    paymentDate: '付款日期',
    orderBeginDate: '合同开始日期',
    orderEndDate: '合同结束日期',
    orderStatus: '合同状态',
    totalReceivables: '应收金额',
    totalReceived: '已收金额',
    totalUncollected: '未收金额',
    invoicedAmount: '已开票金额',
    orderInvoiceStatus: '开票状态',
    flowStatus: '审批状态',
    chargerId: '负责人',
    chargerName: '负责人姓名',
    products: '产品明细',
    remark: '备注',
  },
  payments: {
    customerId: '客户',
    saleOrderId: '合同订单',
    paymentAmount: '金额',
    paymentType: '收款方式',
    businessDate: '业务日期',
    payer: '付款人',
    bankName: '账户',
    tradeSerialNumber: '交易流水号',
    direction: '方向',
    flowStatus: '审批状态',
    relatedPaymentId: '关联回款',
    refundType: '退款类型',
    refundReason: '退款原因',
    chargerId: '负责人',
    chargerName: '负责人姓名',
    invoicedByInvoiceId: '合并到发票',
    remark: '备注',
  },
  invoices: {
    customerId: '客户',
    saleOrderId: '合同订单',
    invoiceType: '发票类型',
    invoiceDate: '开票日期',
    invoiceNumber: '发票号',
    invoiceAmount: '开票金额',
    invoiceStatus: '发票状态',
    itemType: '项目类型',
    title: '抬头',
    taxIdentifyNum: '税号',
    bankName: '开户行',
    bankAccount: '银行账号',
    registeredAddress: '注册地址',
    registeredPhone: '注册电话',
    flowStatus: '审批状态',
    chargerId: '负责人',
    chargerName: '负责人姓名',
    sourcePaymentIds: '合并来源回款',
    remark: '备注',
  },
  'keep-records': {
    customerId: '客户',
    contactId: '联系人',
    keepRecordType: '跟进方式',
    keepRecordTime: '跟进时间',
    keepRecordContent: '跟进内容',
    keepRecordStatus: '跟进状态',
    chargerId: '跟进人',
    attachments: '附件',
  },
  'visit-records': {
    customerId: '客户',
    contactId: '联系人',
    visitType: '拜访类型',
    content: '拜访内容',
    signInTime: '签到时间',
    signOutTime: '签退时间',
    signAddress: '签到地址',
    duration: '拜访时长',
    visitStatus: '拜访状态',
    flowStatus: '审批状态',
    latitude: '纬度',
    longitude: '经度',
    visitPurpose: '拜访目的',
    visitResult: '拜访结果',
    chargerId: '拜访人',
    attachments: '附件',
    remark: '备注',
  },
  'crm-products': {
    productName: '产品名称',
    productNumber: '产品编号',
    productTypes: '产品类型',
    productUnit: '产品单位',
    standardPrice: '标准价格',
    productStatus: '产品状态',
    remark: '备注',
  },
};

@Injectable()
export class CrmChangeLogService {
  private readonly logger = new Logger(CrmChangeLogService.name);

  constructor(private readonly operationLogsService: OperationLogsService) {}

  async logChange(options: CrmChangeLogOptions): Promise<void> {
    const before = normalizeRecord(options.before);
    const after = normalizeRecord(options.after);
    const changes = buildChanges(options.module, before, after);

    if (options.action === 'update' && changes.length === 0) {
      return;
    }

    const details = {
      kind: 'change',
      targetName: options.targetName ?? null,
      before: pickChangedValues(before, changes, 'before'),
      after: pickChangedValues(after, changes, 'after'),
      changes,
    };

    try {
      await this.operationLogsService.log({
        employeeId: options.currentUser?.employeeId ?? options.currentUser?.id ?? null,
        module: options.module,
        action: options.action,
        target: options.target,
        targetCustomerId: deriveTargetCustomerId(options.module, options.target, before, after),
        details,
      });
    } catch (error) {
      this.logger.error(
        `CRM 变更日志写入失败: module=${options.module}, target=${options.target}, action=${
          options.action
        }, error=${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

/**
 * 推导 OperationLog.targetCustomerId（2026-06-16 活动时间线投影）：
 *  - module='customers' → target 本身就是 customer.id
 *  - 其他 CRM module（contacts/opportunities/sale-orders/payments/invoices/keep-records/visit-records）
 *    → before/after 通常带 customerId 字段
 *  - 非 CRM 或无客户归属（crm-products 等）→ null（不进客户活动流）
 *
 * 推导只读 before/after.customerId，不发起额外查询，保持 logChange 路径无 IO 开销。
 */
function deriveTargetCustomerId(
  module: string,
  target: string | undefined,
  before: JsonRecord | undefined,
  after: JsonRecord | undefined
): string | null {
  if (module === 'customers') {
    return typeof target === 'string' && target.length > 0 ? target : null;
  }
  const candidate = (after?.['customerId'] ?? before?.['customerId']) as unknown;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

function buildChanges(
  module: string,
  before: JsonRecord | undefined,
  after: JsonRecord | undefined
): CrmFieldChange[] {
  if (!before && !after) return [];

  const keys = new Set<string>([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const labels = FIELD_LABELS[module] ?? {};
  const changes: CrmFieldChange[] = [];

  for (const field of keys) {
    if (!shouldCompareField(field, before?.[field], after?.[field])) continue;

    const rawBeforeValue = before?.[field] ?? null;
    const rawAfterValue = after?.[field] ?? null;
    if (stableStringify(rawBeforeValue) === stableStringify(rawAfterValue)) continue;

    const beforeValue = getDisplayValue(field, before, rawBeforeValue);
    const afterValue = getDisplayValue(field, after, rawAfterValue);

    changes.push({
      field,
      label: labels[field] ?? field,
      before: beforeValue,
      after: afterValue,
    });
  }

  return changes;
}

function shouldCompareField(field: string, beforeValue: unknown, afterValue: unknown): boolean {
  if (SYSTEM_FIELDS.has(field) || RELATION_FIELDS.has(field)) return false;
  const value = afterValue !== undefined ? afterValue : beforeValue;
  if (value === undefined) return false;
  if (isPlainObject(value)) return false;
  return true;
}

function getDisplayValue(
  field: string,
  record: JsonRecord | undefined,
  fallback: unknown
): unknown {
  if (!record) return fallback;

  switch (field) {
    case 'chargerId':
      return (
        getStringValue(record, 'chargerName') ??
        getNestedStringValue(record, 'charger', 'name') ??
        fallback
      );
    case 'customerId':
      return (
        getNestedStringValue(record, 'customer', 'customerName') ??
        getNestedStringValue(record, 'customer', 'shortName') ??
        fallback
      );
    case 'contactId':
      return getNestedStringValue(record, 'contact', 'contactName') ?? fallback;
    case 'saleOrderId':
      return (
        getNestedStringValue(record, 'saleOrder', 'orderTitle') ??
        getNestedStringValue(record, 'saleOrder', 'serialNumber') ??
        fallback
      );
    case 'opportunityId':
      return getNestedStringValue(record, 'opportunity', 'opportunityName') ?? fallback;
    case 'relatedPaymentId':
      return getNestedStringValue(record, 'relatedPayment', 'serialNumber') ?? fallback;
    default:
      return fallback;
  }
}

function getStringValue(record: JsonRecord, field: string): string | null {
  const value = record[field];
  return typeof value === 'string' && value.trim() ? value : null;
}

function getNestedStringValue(record: JsonRecord, relation: string, field: string): string | null {
  const value = record[relation];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return getStringValue(value as JsonRecord, field);
}

function pickChangedValues(
  record: JsonRecord | undefined,
  changes: CrmFieldChange[],
  side: 'before' | 'after'
): JsonRecord | undefined {
  if (!record) return undefined;
  const result: JsonRecord = {};
  for (const change of changes) {
    result[change.field] = side === 'before' ? change.before : change.after;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeRecord(value: unknown): JsonRecord | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return normalizeValue(value) as JsonRecord;
}

function normalizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value instanceof Date) return value.toISOString();
  if (isDecimalLike(value)) return decimalToJsonValue(value);
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item)).filter((item) => item !== undefined);
  }
  if (value && typeof value === 'object') {
    const result: JsonRecord = {};
    for (const [key, child] of Object.entries(value as JsonRecord)) {
      const normalized = normalizeValue(child);
      if (normalized !== undefined) {
        result[key] = normalized;
      }
    }
    return result;
  }
  return value;
}

function isPlainObject(value: unknown): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
}

function isDecimalLike(value: unknown): value is Decimal | { toNumber: () => number } {
  return (
    value instanceof Decimal ||
    (!!value &&
      typeof value === 'object' &&
      typeof (value as { toNumber?: unknown }).toNumber === 'function' &&
      typeof (value as { toString?: unknown }).toString === 'function')
  );
}

function decimalToJsonValue(value: Decimal | { toNumber: () => number }): number | string {
  try {
    return value.toNumber();
  } catch {
    return String(value);
  }
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortForStableStringify(value));
}

function sortForStableStringify(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortForStableStringify(item));
  if (isPlainObject(value)) {
    const result: JsonRecord = {};
    for (const key of Object.keys(value as JsonRecord).sort()) {
      result[key] = sortForStableStringify((value as JsonRecord)[key]);
    }
    return result;
  }
  return value;
}
