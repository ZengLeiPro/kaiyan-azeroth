/**
 * ActivityMapper —— 把 keep_records / visit_records / operation_logs(kind='change')
 * 三种数据源投影成统一的 ActivityItem。
 *
 * 设计：
 *  - 纯函数，无 IO，便于单测
 *  - importance 分级表硬编码在这里；上线后看实际效果再调
 *  - summary 一行摘要规则：跟进/拜访取内容首行；operation_log 取字段级 diff 的关键字
 */

import {
  ACTIVITY_CATEGORY,
  ACTIVITY_IMPORTANCE,
  ACTIVITY_SOURCE,
  type ActivityCategory,
  type ActivityFieldChange,
  type ActivityImportance,
  type ActivityItem,
} from '@ky-azeroth/shared/schemas/activity';

// ── 输入类型（与 Prisma include 对齐） ──────────────────────────────────

export interface KeepRecordRow {
  id: string;
  customerId: string;
  keepRecordType: string | null;
  keepRecordTime: Date | null;
  keepRecordContent: string | null;
  keepRecordStatus: string | null;
  chargerId: string | null;
  chargerName: string | null;
  createdAt: Date;
  signAddress?: string | null;
  attachments?: unknown;
}

export interface VisitRecordRow {
  id: string;
  customerId: string;
  visitType: string | null;
  content: string | null;
  signInTime: Date | null;
  signOutTime: Date | null;
  signAddress: string | null;
  duration: number | null;
  visitStatus: string | null;
  chargerId: string | null;
  chargerName: string | null;
  createdAt: Date;
}

export interface OperationLogRow {
  id: string;
  employeeId: string | null;
  module: string;
  action: string;
  target: string | null;
  targetCustomerId: string | null;
  details: unknown;
  createdAt: Date;
  employee?: { id: string; name: string | null; username: string | null } | null;
}

/**
 * 2026-06-16：sales_action_items 表本身作为活动数据源。
 * 字段对齐 prisma `sales_action_items` 模型；每行投影成 1 个 ActivityItem。
 * occurredAt 选取规则：已结案（resolvedAt 非空）用 resolvedAt，未结案用 createdAt。
 */
export interface SalesActionItemRow {
  id: string;
  category: string; // 待办自身的 category（FOLLOW_UP_DUE/DEAL_COOLING/...），与 ActivityCategory 不是一个维度
  priority: number;
  refType: string | null;
  refId: string | null;
  title: string;
  reason: string;
  status: string; // pending / adopted / done / ignored / snoozed / auto_expired / transferred
  doneType: string | null;
  resolveNote: string | null;
  /** 待办负责人（收件销售）—— 当 actor 字段缺失时回退 */
  employeeId: string | null;
  employee?: { id: string; name: string | null; username: string | null } | null;
  resolvedById: string | null;
  resolvedBy?: { id: string; name: string | null; username: string | null } | null;
  resolvedAt: Date | null;
  createdAt: Date;
  /** 反查到的客户 id（在 service 层 join 后注入） */
  customerId: string;
}

// ── 模块 → category 映射 ───────────────────────────────────────────────

const MODULE_TO_CATEGORY: Record<string, ActivityCategory> = {
  customers: ACTIVITY_CATEGORY.CUSTOMER,
  contacts: ACTIVITY_CATEGORY.CONTACT,
  opportunities: ACTIVITY_CATEGORY.OPPORTUNITY,
  'sale-orders': ACTIVITY_CATEGORY.ORDER,
  payments: ACTIVITY_CATEGORY.PAYMENT,
  invoices: ACTIVITY_CATEGORY.INVOICE,
  'keep-records': ACTIVITY_CATEGORY.FOLLOW_UP,
  'visit-records': ACTIVITY_CATEGORY.VISIT,
};

export function moduleToCategory(module: string): ActivityCategory | null {
  return MODULE_TO_CATEGORY[module] ?? null;
}

/**
 * 2026-06-16：payments 模块按资金流方向二次分流（refund vs payment）。
 * 只在 details.after 含 direction 字段时（create 必带；update 不会改 direction）才拆；
 * 缺字段默认归 payment（向后兼容历史 op_log）。
 */
function refinePaymentCategory(details: Record<string, unknown>): ActivityCategory {
  const after = (details['after'] as Record<string, unknown> | undefined) ?? undefined;
  const before = (details['before'] as Record<string, unknown> | undefined) ?? undefined;
  const direction =
    (after?.['direction'] as string | undefined) ?? (before?.['direction'] as string | undefined);
  if (direction === 'OUT') return ACTIVITY_CATEGORY.REFUND;
  return ACTIVITY_CATEGORY.PAYMENT;
}

/**
 * 2026-06-16 P2：create 动作的「事件发生时间」用业务时间，而不是写入时间。
 * 例：7 月录入 6 月发生的回款，timeline 应排在 6 月（业务发生时）而非 7 月（录入时）。
 * update 仍用 createdAt（动作发生时间）。
 * 业务时间字段缺失时回退到 createdAt。
 */
const BUSINESS_DATE_FIELDS_BY_MODULE: Record<string, readonly string[]> = {
  'sale-orders': ['businessDate'],
  payments: ['businessDate'],
  invoices: ['invoiceDate'],
  opportunities: ['realDealDate', 'expectedDealDate'],
};

function pickCreateBusinessDate(module: string, details: Record<string, unknown>): Date | null {
  const fields = BUSINESS_DATE_FIELDS_BY_MODULE[module];
  if (!fields) return null;
  const after = (details['after'] as Record<string, unknown> | undefined) ?? undefined;
  if (!after) return null;
  for (const field of fields) {
    const raw = after[field];
    if (!raw) continue;
    const parsed = raw instanceof Date ? raw : new Date(String(raw));
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  return null;
}

// ── importance 分级表 ──────────────────────────────────────────────────

/**
 * 触发 milestone 的字段（按 module）。
 * 不在此表 → normal；备注/标签/附件 → trivial。
 */
const MILESTONE_FIELDS: Record<string, ReadonlySet<string>> = {
  customers: new Set([
    'customerName',
    'dealStatus',
    'leadStage',
    'leadProgressStatus',
    'leadAppointmentAt',
    'chargerId',
  ]),
  contacts: new Set([]), // 联系人 update 默认 normal，新建/作废另算
  opportunities: new Set(['opportunityStage', 'realDealDate', 'lostDate']),
  'sale-orders': new Set(['orderStatus', 'flowStatus']),
  payments: new Set(['flowStatus', 'paymentAmount']),
  invoices: new Set(['invoiceStatus', 'flowStatus']),
};

const TRIVIAL_FIELDS = new Set([
  'remark',
  'attachments',
  'customerTags',
  'aiInfoSummary',
  'collaboratorIds',
  'collaboratorName',
]);

/**
 * 金额字段（变化 > 20% 升级为 milestone）
 */
const AMOUNT_FIELDS_BY_MODULE: Record<string, ReadonlySet<string>> = {
  opportunities: new Set(['opportunityAmount']),
  'sale-orders': new Set(['orderAmount']),
  payments: new Set(['paymentAmount']),
  invoices: new Set(['invoiceAmount']),
};

function isAmountField(module: string, field: string): boolean {
  return AMOUNT_FIELDS_BY_MODULE[module]?.has(field) ?? false;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function amountChangeRatio(before: unknown, after: unknown): number | null {
  const b = toNumber(before);
  const a = toNumber(after);
  if (b === null || a === null) return null;
  if (b === 0 && a === 0) return 0;
  if (b === 0) return Infinity;
  return Math.abs((a - b) / b);
}

export function deriveImportance(
  module: string,
  action: string,
  changes: ActivityFieldChange[]
): ActivityImportance {
  // 新建/作废 → 视 module：CRM 主实体一律 milestone
  if (action === 'create' || action === 'delete') {
    if (
      module === 'customers' ||
      module === 'opportunities' ||
      module === 'sale-orders' ||
      module === 'payments' ||
      module === 'invoices' ||
      module === 'contacts'
    ) {
      return ACTIVITY_IMPORTANCE.MILESTONE;
    }
    return ACTIVITY_IMPORTANCE.NORMAL;
  }

  // update：扫所有变更字段，取最高档
  let best: ActivityImportance = ACTIVITY_IMPORTANCE.TRIVIAL;
  const milestoneSet = MILESTONE_FIELDS[module];

  for (const change of changes) {
    if (TRIVIAL_FIELDS.has(change.field)) continue; // trivial 不抬级

    // 金额字段：变化 > 20% → milestone，否则 normal
    if (isAmountField(module, change.field)) {
      const ratio = amountChangeRatio(change.before, change.after);
      if (ratio !== null && ratio > 0.2) {
        return ACTIVITY_IMPORTANCE.MILESTONE;
      }
      if (best === ACTIVITY_IMPORTANCE.TRIVIAL) best = ACTIVITY_IMPORTANCE.NORMAL;
      continue;
    }

    if (milestoneSet?.has(change.field)) {
      return ACTIVITY_IMPORTANCE.MILESTONE;
    }
    if (best === ACTIVITY_IMPORTANCE.TRIVIAL) best = ACTIVITY_IMPORTANCE.NORMAL;
  }
  return best;
}

// ── summary 一行摘要 ──────────────────────────────────────────────────

const ACTION_LABEL: Record<string, string> = {
  create: '新增',
  update: '更新',
  delete: '删除',
};

const MODULE_LABEL: Record<string, string> = {
  customers: '客户',
  contacts: '联系人',
  opportunities: '商机',
  'sale-orders': '订单',
  payments: '回款',
  invoices: '发票',
  'keep-records': '跟进',
  'visit-records': '拜访',
};

/**
 * 2026-06-16：payments 模块在 summary 里按 direction 切换"回款/退款"标签。
 */
function resolveModuleLabel(module: string, details: Record<string, unknown> | null): string {
  const fallback = MODULE_LABEL[module] ?? module;
  if (module !== 'payments' || !details) return fallback;
  const after = details['after'] as Record<string, unknown> | undefined;
  const before = details['before'] as Record<string, unknown> | undefined;
  const direction =
    (after?.['direction'] as string | undefined) ?? (before?.['direction'] as string | undefined);
  return direction === 'OUT' ? '退款' : fallback;
}

function firstLine(text: string | null | undefined, maxLen = 60): string {
  if (!text) return '';
  const line = text.split(/\r?\n/)[0]?.trim() ?? '';
  return line.length > maxLen ? `${line.slice(0, maxLen)}…` : line;
}

function formatChangeFragment(change: ActivityFieldChange): string {
  const beforeStr = formatScalar(change.before);
  const afterStr = formatScalar(change.after);
  if (!beforeStr && afterStr) return `${change.label}：→${afterStr}`;
  if (beforeStr && !afterStr) return `${change.label}：${beforeStr}→空`;
  return `${change.label}：${beforeStr}→${afterStr}`;
}

function formatScalar(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'string') {
    return value.length > 20 ? `${value.slice(0, 20)}…` : value;
  }
  return JSON.stringify(value).slice(0, 30);
}

export function buildOperationLogSummary(log: OperationLogRow): string {
  const details = log.details as Record<string, unknown> | null;
  const moduleLabel = resolveModuleLabel(log.module, details);
  const actionLabel = ACTION_LABEL[log.action] ?? log.action;
  const targetName = typeof details?.targetName === 'string' ? details.targetName : null;

  if (log.action === 'create' || log.action === 'delete') {
    return targetName
      ? `${actionLabel}${moduleLabel} ${targetName}`
      : `${actionLabel}${moduleLabel}`;
  }

  // update：取前 2 个 milestone 字段，没有就取前 2 个非 trivial
  const changes = (details?.changes as ActivityFieldChange[] | undefined) ?? [];
  const milestoneSet = MILESTONE_FIELDS[log.module];
  const priorityFields = changes.filter(
    (c) => milestoneSet?.has(c.field) || isAmountField(log.module, c.field)
  );
  const picked =
    priorityFields.length > 0
      ? priorityFields
      : changes.filter((c) => !TRIVIAL_FIELDS.has(c.field));
  const fragments = picked.slice(0, 2).map(formatChangeFragment);

  const prefix = targetName ? `${moduleLabel} ${targetName}：` : `${moduleLabel}：`;
  if (fragments.length === 0) {
    return `${prefix}更新（${changes.length} 项）`;
  }
  const suffix = changes.length > fragments.length ? ` 等 ${changes.length} 项` : '';
  return `${prefix}${fragments.join(' / ')}${suffix}`;
}

function buildKeepSummary(row: KeepRecordRow): string {
  const type = row.keepRecordType ? `[${row.keepRecordType}]` : '';
  const content = firstLine(row.keepRecordContent, 50);
  if (!content) return `跟进${type ? ` ${type}` : ''}`;
  return type ? `${type} ${content}` : content;
}

function buildVisitSummary(row: VisitRecordRow): string {
  const parts: string[] = [];
  if (row.visitType) parts.push(`[${row.visitType}]`);
  if (row.signAddress) parts.push(row.signAddress);
  if (row.duration) parts.push(`${row.duration} 分钟`);
  const content = firstLine(row.content, 40);
  if (content) parts.push(content);
  if (parts.length === 0) return '拜访签到';
  return parts.join(' · ');
}

// ── 主投影函数 ─────────────────────────────────────────────────────────

export function mapKeepRecord(row: KeepRecordRow): ActivityItem {
  const occurredAt = (row.keepRecordTime ?? row.createdAt).toISOString();
  return {
    id: `keep:${row.id}`,
    occurredAt,
    source: ACTIVITY_SOURCE.KEEP,
    category: ACTIVITY_CATEGORY.FOLLOW_UP,
    importance: ACTIVITY_IMPORTANCE.MILESTONE,
    action: 'create',
    actorId: row.chargerId,
    actorName: row.chargerName,
    customerId: row.customerId,
    refType: 'KeepRecord',
    refId: row.id,
    refName: firstLine(row.keepRecordContent, 30) || null,
    summary: buildKeepSummary(row),
    detail: {
      content: row.keepRecordContent ?? null,
    },
  };
}

export function mapVisitRecord(row: VisitRecordRow): ActivityItem {
  const occurredAt = (row.signInTime ?? row.createdAt).toISOString();
  return {
    id: `visit:${row.id}`,
    occurredAt,
    source: ACTIVITY_SOURCE.VISIT,
    category: ACTIVITY_CATEGORY.VISIT,
    importance: ACTIVITY_IMPORTANCE.MILESTONE,
    action: 'create',
    actorId: row.chargerId,
    actorName: row.chargerName,
    customerId: row.customerId,
    refType: 'VisitRecord',
    refId: row.id,
    refName: row.signAddress ?? null,
    summary: buildVisitSummary(row),
    detail: {
      content: row.content ?? null,
      location: row.signAddress ?? null,
      duration: row.duration ?? null,
    },
  };
}

export function mapOperationLog(log: OperationLogRow): ActivityItem | null {
  if (!log.targetCustomerId) return null;
  const baseCategory = moduleToCategory(log.module);
  if (!baseCategory) return null;

  const details = (log.details ?? {}) as Record<string, unknown>;
  if (details['kind'] !== 'change') return null;

  const changes = (details['changes'] as ActivityFieldChange[] | undefined) ?? [];
  const targetName = typeof details['targetName'] === 'string' ? details['targetName'] : null;
  const importance = deriveImportance(log.module, log.action, changes);

  // P1: payments 按 direction 拆 refund/payment
  const category = log.module === 'payments' ? refinePaymentCategory(details) : baseCategory;

  // P2: create 用业务时间作为事件发生时间
  const businessDate = log.action === 'create' ? pickCreateBusinessDate(log.module, details) : null;
  const occurredAt = (businessDate ?? log.createdAt).toISOString();

  return {
    id: `op:${log.id}`,
    occurredAt,
    source: ACTIVITY_SOURCE.OPERATION_LOG,
    category,
    importance,
    action: log.action,
    actorId: log.employeeId,
    actorName: log.employee?.name ?? log.employee?.username ?? null,
    customerId: log.targetCustomerId,
    refType: pascalCaseFromModule(log.module),
    refId: log.target,
    refName: targetName,
    summary: buildOperationLogSummary(log),
    detail: {
      changes: changes.length > 0 ? changes : undefined,
      before: (details['before'] as Record<string, unknown> | undefined) ?? undefined,
      after: (details['after'] as Record<string, unknown> | undefined) ?? undefined,
    },
  };
}

function pascalCaseFromModule(module: string): string {
  const map: Record<string, string> = {
    customers: 'Customer',
    contacts: 'Contact',
    opportunities: 'Opportunity',
    'sale-orders': 'SaleOrder',
    payments: 'Payment',
    invoices: 'Invoice',
    'keep-records': 'KeepRecord',
    'visit-records': 'VisitRecord',
  };
  return map[module] ?? module;
}

// ── sales_action_items 投影（2026-06-16） ────────────────────────────
//
// 设计：每行投影成 1 个 ActivityItem。
//  - occurredAt：已结案（resolvedAt 非空）用 resolvedAt（动作时间），未结案用 createdAt。
//  - actor：已结案用 resolvedBy，未结案用 employee（待办收件人）。
//  - importance：
//      done           → milestone（真正办结）
//      adopted        → milestone（采纳生成 keep_record，相当于完成）
//      pending+高优先 → milestone（priority≥70）
//      其他 pending   → normal
//      transferred    → normal
//      ignored / auto_expired / snoozed → trivial（不打扰）
//  - action：直接用 status 字串，便于前端按状态展示徽标。

const SALES_ACTION_STATUS_LABEL: Record<string, string> = {
  pending: '待处理',
  adopted: '已采纳',
  done: '已办结',
  ignored: '已忽略',
  snoozed: '已暂缓',
  auto_expired: '自动失效',
  transferred: '已转交',
};

const SALES_ACTION_CATEGORY_LABEL: Record<string, string> = {
  // 进攻
  FOLLOW_UP_DUE: '跟进到期',
  DEAL_COOLING: '商机降温',
  PAYMENT_SILENT: '应收停滞',
  CUSTOMER_STALE: '客户沉睡',
  // 防御
  GAP_HARD: '硬缺口',
  GAP_SOFT: '软缺口',
  CONFLICT: '冲突',
  FILL_CONFIRM: '补录确认',
};

function deriveSalesActionImportance(row: SalesActionItemRow): ActivityImportance {
  if (row.status === 'done' || row.status === 'adopted') return ACTIVITY_IMPORTANCE.MILESTONE;
  if (row.status === 'pending' && row.priority >= 70) return ACTIVITY_IMPORTANCE.MILESTONE;
  if (row.status === 'ignored' || row.status === 'auto_expired' || row.status === 'snoozed') {
    return ACTIVITY_IMPORTANCE.TRIVIAL;
  }
  return ACTIVITY_IMPORTANCE.NORMAL;
}

function buildSalesActionSummary(row: SalesActionItemRow): string {
  const statusLabel = SALES_ACTION_STATUS_LABEL[row.status] ?? row.status;
  const catLabel = SALES_ACTION_CATEGORY_LABEL[row.category] ?? row.category;
  const title = firstLine(row.title, 50);
  const head = `[${catLabel}] 待办${statusLabel}`;
  return title ? `${head}：${title}` : head;
}

export function mapSalesActionItem(row: SalesActionItemRow): ActivityItem {
  const resolvedTerminalStatuses = new Set([
    'done',
    'adopted',
    'ignored',
    'auto_expired',
    'transferred',
  ]);
  const isResolved = !!row.resolvedAt && resolvedTerminalStatuses.has(row.status);
  const occurredAtDate = isResolved && row.resolvedAt ? row.resolvedAt : row.createdAt;

  const actorEmployee = isResolved ? row.resolvedBy : row.employee;
  const actorId = isResolved ? row.resolvedById : row.employeeId;

  return {
    id: `sai:${row.id}`,
    occurredAt: occurredAtDate.toISOString(),
    source: ACTIVITY_SOURCE.SALES_ACTION_ITEM,
    category: ACTIVITY_CATEGORY.TODO,
    importance: deriveSalesActionImportance(row),
    // action 用 status，前端可据此切换徽标/颜色（pending/done/adopted/...）
    action: row.status,
    actorId,
    actorName: actorEmployee?.name ?? actorEmployee?.username ?? null,
    customerId: row.customerId,
    refType: 'SalesActionItem',
    refId: row.id,
    refName: firstLine(row.title, 30) || null,
    summary: buildSalesActionSummary(row),
    detail: {
      content: row.reason || row.resolveNote || null,
    },
  };
}
