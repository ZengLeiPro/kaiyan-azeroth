import type { IAttachment } from './common';

/**
 * 跟进记录实体
 */
export interface IKeepRecord {
  id: string;
  customerId: string;
  contactId: string | null;
  keepRecordType: string | null;
  keepRecordTime: string | null;
  keepRecordContent: string | null;
  keepRecordStatus: string | null;
  attachments: IAttachment[] | null;
  chargerId: string | null;
  intentTemperature: 'UNJUDGED' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' | null;
  intentReasons: string[] | null;
  nextFollowUpAt: string | null;
  chargerName: string | null;
  flowStatus: string | null;
  // 闭环来源：manual / action_item / dingtalk-sync 等；sourceActionItemId 指回采纳来源待办
  source: string | null;
  sourceActionItemId: string | null;
  // 审计
  createdAt?: string;
  createdBy?: string | null;
  updatedAt?: string;
  updatedBy?: string | null;
  deletedAt?: string | null;
  version?: number;
}

/**
 * 跟进记录关联客户简要信息
 */
export interface IKeepRecordCustomerInfo {
  id: string;
  customerName: string;
  shortName: string | null;
}

/**
 * 跟进记录关联联系人简要信息
 */
export interface IKeepRecordContactInfo {
  id: string;
  contactName: string;
}

/**
 * 跟进记录 API 响应类型
 */
export interface IKeepRecordResponse extends IKeepRecord {
  customer?: IKeepRecordCustomerInfo;
  contact?: IKeepRecordContactInfo;
}

/**
 * 创建跟进记录接口契约
 */
export interface ICreateKeepRecord {
  customerId: string;
  contactId?: string | null;
  keepRecordType: string;
  keepRecordTime: string;
  keepRecordContent: string;
  keepRecordStatus: string;
  attachments?: IAttachment[] | null;
  chargerId: string;
  intentTemperature?: 'UNJUDGED' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' | null;
  intentReasons?: string[] | null;
  nextFollowUpAt?: string | null;
  // 闭环采纳写入时由后端注入（前端创建一般不传）
  source?: string | null;
  sourceActionItemId?: string | null;
}

/**
 * 更新跟进记录接口契约
 */
export type IUpdateKeepRecord = Partial<ICreateKeepRecord>;
