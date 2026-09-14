import type { IndustryValue, LeadProgressStatusValue } from '../constants/status-values';
import type { DecimalNumber } from './common';

/**
 * 客户实体
 */
export interface ICustomer {
  id: string;
  serialNumber: string;
  customerName: string;
  shortName: string | null;
  industry: string | null;
  customerLevel: string | null;
  customerSource: string | null;
  customerRelationship: string | null;
  customerTags: string[] | null;
  // 地址
  country: string | null;
  province: string | null;
  city: string | null;
  district: string | null;
  address: string | null;
  remark: string | null;
  aiInfoSummary: string | null;
  aiInfoGeneratedAt: string | null;
  // 组织信息
  organizationId: string | null;
  uncId: string | null;
  headcountRange: string | null;
  // 负责人
  chargerId: string | null;
  chargerName: string | null;
  collaboratorName: string | null;
  collaboratorIds: string[] | null;
  // 跟进状态
  contactStatus: string | null;
  dealStatus: string | null;
  // 线索阶段（MQL/SQL）
  leadStage: string | null;
  leadStageUpdatedAt: string | null;
  leadStageUpdatedById: string | null;
  leadStageUpdatedByName: string | null;
  leadStageQualifiedById: string | null;
  leadStageQualifiedByName: string | null;
  leadStageQualifiedAt: string | null;
  // 首次进入 MQL/SQL 时间（write-once，永不覆盖；cohort 漏斗分析用）
  firstMqlAt: string | null;
  firstSqlAt: string | null;
  // Leads 推进状态（与 MQL/SQL 阶段分离）
  leadProgressStatus: LeadProgressStatusValue | null;
  leadAppointmentAt: string | null;
  leadProgressReason: string | null;
  leadProgressUpdatedAt: string | null;
  leadProgressUpdatedById: string | null;
  intentTemperature: 'UNJUDGED' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' | null;
  intentReasons: string[] | null;
  nextFollowUpAt: string | null;
  intentUpdatedAt: string | null;
  intentUpdatedById: string | null;
  intentUpdatedByName?: string | null;
  intentSourceKeepRecordId: string | null;
  leadValidity: 'VALID' | 'INVALID';
  leadInvalidReason: 'EMPTY_PHONE' | 'CLOSED' | 'DUPLICATE' | 'NON_TARGET' | null;
  lastKeepRecordTime: string | null;
  lastKeepRecordContent: string | null;
  // 财务概要
  /** @precision Decimal */
  accountsReceivable: DecimalNumber | null;
  // 状态
  flowStatus: string | null;
  status: string;
  // 审计
  createdAt?: string;
  createdBy?: string | null;
  updatedAt?: string;
  updatedBy?: string | null;
  deletedAt?: string | null;
  version?: number;
}

/**
 * 客户 API 响应类型
 */
export interface ICustomerResponse extends ICustomer {
  /** 服务端实体事实；所有 Customer 写操作都依赖该正整数版本做乐观锁。 */
  version: number;
  /** 关联联系人列表 */
  contacts?: ICustomerContactInfo[];
}

/**
 * 客户关联联系人简要信息
 */
export interface ICustomerContactInfo {
  id: string;
  contactName: string;
  mobile: string | null;
  phone: string | null;
  position: string | null;
}

export type CustomerDuplicateMatchField =
  | 'customerName'
  | 'shortName'
  | 'contactPhone'
  | 'uncId'
  | 'organizationId';

export interface ICheckCustomerDuplicate {
  customerName?: string | null;
  shortName?: string | null;
  phone?: string | null;
  uncId?: string | null;
  organizationId?: string | null;
  excludeId?: string | null;
}

export interface ICustomerDuplicateMatch {
  id: string;
  serialNumber: string;
  customerName: string;
  shortName: string | null;
  uncId: string | null;
  organizationId: string | null;
  chargerId: string | null;
  chargerName: string | null;
  pool: 'private' | 'public';
  matchedFields: CustomerDuplicateMatchField[];
  /**
   * 当前用户能否打开该客户详情（口径与 GET /customers/:id 一致：
   * 范围内私海 OR 本人协作 OR 公海）。前端据此决定是否渲染穿透链接；
   * false（别人私海）只展示负责人信息，不放开点击。
   */
  accessible: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ICustomerDuplicateCheckResponse {
  total: number;
  items: ICustomerDuplicateMatch[];
}

/**
 * 创建客户接口契约
 */
export interface ICreateCustomer {
  customerName: string;
  shortName?: string | null;
  industry?: IndustryValue | null;
  customerLevel?: string | null;
  customerSource?: string | null;
  customerRelationship?: string | null;
  customerTags?: string[] | null;
  country?: string | null;
  province?: string | null;
  city?: string | null;
  district?: string | null;
  address?: string | null;
  remark?: string | null;
  aiInfoSummary?: string | null;
  organizationId?: string | null;
  uncId?: string | null;
  headcountRange?: string | null;
  chargerId?: string | null;
  collaboratorName?: string | null;
  collaboratorIds?: string[] | null;
  contactStatus?: string | null;
  dealStatus?: string | null;
  /** 线索阶段（MQL/SQL）—— 字段级守卫：非 ADMIN PUT 修改会被拒，需走专用审批端点 */
  leadStage?: 'MQL' | 'SQL' | null;
  /** 合格判定人 employeeId（默认 = 当前操作人；可显式传"外勤反馈+中台代录"场景） */
  leadStageQualifiedById?: string | null;
  leadValidity?: 'VALID' | 'INVALID';
  leadInvalidReason?: 'EMPTY_PHONE' | 'CLOSED' | 'DUPLICATE' | 'NON_TARGET' | null;
  /** 软查重旁路：true 时跳过 service.create 的同名校验。前端弹卡确认后传入。 */
  forceCreate?: boolean;
  /** 软查重 forceCreate=true 时用户填写的强制创建原因，写入审计日志（operation_logs）。 */
  forceCreateReason?: string | null;
}

/**
 * 普通客户更新接口契约。
 *
 * 派生字段与线索阶段只能走专用业务入口；version 为必填正整数，具体运行时约束由
 * updateCustomerSchema 统一校验。
 */
export type IUpdateCustomer = Partial<
  Omit<
    ICreateCustomer,
    | 'aiInfoSummary'
    | 'collaboratorName'
    | 'contactStatus'
    | 'dealStatus'
    | 'leadStage'
    | 'leadStageQualifiedById'
    | 'forceCreate'
    | 'forceCreateReason'
  >
> & { version: number };
