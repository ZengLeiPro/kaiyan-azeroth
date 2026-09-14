import type {
  CreateSalesActionItemInput,
  SalesActionEvidenceCalendar,
  SalesActionEvidenceCrm,
  SalesActionEvidenceDingtalk,
  SalesActionEvidenceDoc,
  SalesActionEvidenceInput,
  SalesActionEvidenceOutput,
  SalesActionEvidenceWebsite,
  UpdateSalesActionItemInput,
} from '../schemas/sales-action-item';

/**
 * 销售数据待办/作战项（销售数据闭环系统）类型契约
 *
 * 对应 Prisma model SalesActionItem（apps/server/prisma/schema.prisma）。
 * 夜间缺口侦探 + 晨间作战信号共用一张表，category 区分进攻/防御。
 *
 * 写入红线（D1）：任何 AI 抽取/补全一律进此表，人工一键采纳才写 CRM，绝不夜间直接写库。
 */

/**
 * category 取值
 * - 进攻（今日作战卡）：WEBSITE_LEAD_NEW 官网新线索 / FOLLOW_UP_DUE 跟进到期 / DEAL_COOLING 商机变冷 /
 *   PAYMENT_SILENT 应收静默 / CUSTOMER_STALE 客户失联
 * - 防御（数据待办卡）：GAP_HARD 硬缺口 / GAP_SOFT 软缺口 /
 *   CONFLICT 数据矛盾 / FILL_CONFIRM 补录确认（唯一可一键采纳写跟进）
 */
export type SalesActionItemCategory =
  | 'WEBSITE_LEAD_NEW'
  | 'FOLLOW_UP_DUE'
  | 'DEAL_COOLING'
  | 'PAYMENT_SILENT'
  | 'CUSTOMER_STALE'
  | 'GAP_HARD'
  | 'GAP_SOFT'
  | 'CONFLICT'
  | 'FILL_CONFIRM';

/** confidence 取值：HIGH 硬缺口/高置信、MEDIUM 软缺口（须标"疑似"+附证据） */
export type SalesActionItemConfidence = 'HIGH' | 'MEDIUM';

/**
 * status 状态机
 * pending（待处理）→ adopted（已采纳，仅 FILL_CONFIRM+keep_record）
 *                  → done（已办结）→ ignored（已忽略，必填理由）
 *                  → snoozed（已稍后）→ transferred（已转交）→ auto_expired（自动失效，缺口已被其它动作回收）
 */
export type SalesActionItemStatus =
  | 'pending'
  | 'adopted'
  | 'done'
  | 'ignored'
  | 'snoozed'
  | 'transferred'
  | 'auto_expired';

/** done 办结类型：仅手工「标记已办」时使用 */
export type SalesActionItemDoneType =
  | 'follow_recorded'
  | 'progressed'
  | 'shelved'
  | 'false_alarm'
  | 'other';

/**
 * aiDraft 采纳草稿（勘察 09 §1.5）。
 * 仅 kind='keep_record' 可被 adopt 端点一键采纳写入跟进记录；
 * 且后端强校验（D6/Codex A4）须含 matchMode='FULL_NAME_EXPLICIT' + matchedCustomerId
 * + matchedFullName + evidenceMessageId，缺一拒绝采纳（返回错误而非静默写）。
 * 订单/回款/发票等 kind 一律拒绝（只放 keep_record）。
 */
export interface ISalesActionItemKeepRecordDraft {
  kind: 'keep_record';
  /** 客户匹配模式；仅 FULL_NAME_EXPLICIT（客户全称被明确点到）允许采纳 */
  matchMode: 'FULL_NAME_EXPLICIT';
  /** 匹配到的唯一客户 id */
  matchedCustomerId: string;
  /** 匹配到的客户全称（与消息原文点到的一致） */
  matchedFullName: string;
  /** 证据来源的钉钉消息 id（溯源） */
  evidenceMessageId: string;
  /** 写入 KeepRecordsService.create 的负载 */
  payload: {
    customerId: string;
    keepRecordType: string;
    keepRecordContent: string;
    keepRecordTime: string;
    contactId?: string | null;
  };
}

/** aiDraft 顶层类型（首版仅 keep_record；其它 kind 占位，不允许采纳） */
export type ISalesActionItemAiDraft = ISalesActionItemKeepRecordDraft;

/** evidence 类型全部由 Shared Zod schema 推导，避免写入、响应与前端平行维护契约。 */
export type ISalesActionEvidenceDingtalk = SalesActionEvidenceDingtalk;
export type ISalesActionEvidenceDoc = SalesActionEvidenceDoc;
export type ISalesActionEvidenceCalendar = SalesActionEvidenceCalendar;
export type ISalesActionEvidenceCrm = SalesActionEvidenceCrm;
export type ISalesActionEvidenceWebsite = SalesActionEvidenceWebsite;
export type ISalesActionEvidenceInput = SalesActionEvidenceInput;
export type ISalesActionEvidence = SalesActionEvidenceOutput;

/**
 * 销售数据待办实体
 */
export interface ISalesActionItem {
  id: string;
  employeeId: string;
  category: SalesActionItemCategory | string;
  priority: number;
  refType: string | null;
  refId: string | null;
  title: string;
  reason: string;
  suggestedAction: string | null;
  aiDraft: ISalesActionItemAiDraft | null;
  evidence: ISalesActionEvidence | null;
  confidence: SalesActionItemConfidence | string;
  dedupKey: string;
  status: SalesActionItemStatus | string;
  resolveNote: string | null;
  doneType: SalesActionItemDoneType | string | null;
  snoozeUntil: string | null;
  remindCount: number;
  resultType: string | null;
  resultId: string | null;
  sourceRunId: string | null;
  createdVia: string;
  // 审计
  createdAt?: string;
  creatorEmployeeId?: string | null;
  updatedAt?: string;
  updaterEmployeeId?: string | null;
  resolvedAt?: string | null;
  resolvedById?: string | null;
  resolvedByName?: string | null;
  deletedAt?: string | null;
  version?: number;
}

/**
 * 待办关联收件销售简要信息
 */
export interface ISalesActionItemEmployeeInfo {
  id: string;
  name: string;
}

/**
 * 待办结构化关联客户简要信息（仅由 UUID/关联实体解析，禁止文本猜测）。
 */
export interface ISalesActionItemCustomerInfo {
  id: string;
  customerName: string;
}

/**
 * 销售数据待办 API 响应类型
 */
export interface ISalesActionItemResponse extends ISalesActionItem {
  employee?: ISalesActionItemEmployeeInfo;
  resolvedBy?: ISalesActionItemEmployeeInfo | null;
  customerName?: string | null;
  customer?: ISalesActionItemCustomerInfo;
}

/** 创建/更新写契约直接由 Zod schema 推导；尤其 evidence 不复用可 title-only 的读类型。 */
export type ICreateSalesActionItem = CreateSalesActionItemInput;
export type IUpdateSalesActionItem = UpdateSalesActionItemInput;

/**
 * 忽略待办入参（resolveNote 必填，D7 可审计）
 */
export interface IIgnoreSalesActionItem {
  resolveNote: string;
}

/**
 * 办结待办入参（doneType + resolveNote 必填；follow_recorded 时 keepRecord 必填）
 */
export interface IDoneSalesActionItemKeepRecord {
  contactId?: string | null;
  keepRecordType: string;
  keepRecordTime: string;
  keepRecordContent: string;
  keepRecordStatus: string;
}

export interface IDoneSalesActionItem {
  doneType: SalesActionItemDoneType | string;
  resolveNote: string;
  keepRecord?: IDoneSalesActionItemKeepRecord;
}

/**
 * 转交待办入参（管理端动作）：把当前待办转交给另一位员工，必须填写原因。
 */
export interface ITransferSalesActionItem {
  targetEmployeeId: string;
  reason: string;
}
