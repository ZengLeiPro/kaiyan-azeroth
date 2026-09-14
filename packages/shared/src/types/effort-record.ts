import type { DecimalNumber } from './common';

/**
 * 工时记录实体
 */
export interface IEffortRecord {
  id: string;
  projectId: string;
  /** @precision Decimal */
  actualTime: DecimalNumber;
  description?: string | null;
  workType?: string | null;
  /** 工时归属日期 YYYY-MM-DD */
  workDate?: string | null;
  /** 记录类型：ACTUAL=实际工时，PLAN=工作计划 */
  recordType?: string | null;
  /** 工时负责人ID（前端提交时填充，后端透传存储） */
  ownerId?: string | null;
  /** 工时负责人姓名（冗余存储，前端提交时填充） */
  ownerName?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  createdAt?: string;
  createdBy?: string | null;
  updatedAt?: string;
  updatedBy?: string | null;
  deletedAt?: string | null;
  version?: number;
}

/**
 * 工时记录关联的项目简要信息
 */
export interface IEffortRecordProjectInfo {
  id: string;
  name: string;
  customerName?: string | null;
}

/**
 * 工时记录 API 响应类型
 */
export interface IEffortRecordResponse extends Omit<IEffortRecord, 'version'> {
  version: number;
  project?: IEffortRecordProjectInfo;
}

/**
 * 创建工时记录接口契约
 */
export interface ICreateEffortRecord {
  projectId: string;
  /** @precision Decimal */
  actualTime: DecimalNumber;
  description: string;
  workType?: string | null;
  /** 工时归属日期 YYYY-MM-DD */
  workDate?: string | null;
  /** 记录类型，默认 ACTUAL */
  recordType?: string | null;
  /** 工时负责人ID（Employee.id） */
  ownerId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

/**
 * 更新工时记录接口契约
 */
export type IUpdateEffortRecord = Partial<ICreateEffortRecord> & { version: number };

/**
 * 批量创建工时记录请求体
 */
export interface IBatchCreateEffortRecord {
  items: ICreateEffortRecord[];
}

/**
 * 批量创建工时记录响应
 */
export interface IBatchCreateEffortRecordResponse {
  created: number;
  records: IEffortRecordResponse[];
}

// ──── 工时统计聚合响应（GET /effort-records/stats，按 groupBy 返回不同形态） ────
// 唯一事实来源：后端 effort-stats.service 与前端 use-effort-stats 均从此导入。

/** 按人统计（groupBy=person） */
export interface IEffortPersonStat {
  ownerId: string;
  ownerName: string | null;
  totalHours: number;
  recordCount: number;
  /** 饱和度 = totalHours / (工作日数 × 8) */
  saturation: number;
}

/** 按项目统计（groupBy=project） */
export interface IEffortProjectStat {
  projectId: string;
  projectName: string | null;
  customerName: string | null;
  totalHours: number;
  participantCount: number;
}

/** 按客户统计（groupBy=customer） */
export interface IEffortCustomerStat {
  customerId: string;
  customerName: string | null;
  totalHours: number;
  totalCost: number;
}

/** 按工作类型统计（groupBy=worktype） */
export interface IEffortWorkTypeStat {
  workType: string;
  totalHours: number;
  recordCount: number;
  percentage: number;
}

/** 填报完整性检查（groupBy=completion） */
export interface IEffortCompletionRecord {
  employeeId: string;
  employeeName: string;
  date: string;
  filled: boolean;
}
