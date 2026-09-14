import type { IAttachment } from './common';

/**
 * 拜访签到实体
 */
export interface IVisitRecord {
  id: string;
  customerId: string;
  contactId: string | null;
  visitType: string | null;
  content: string | null;
  signInTime: string | null;
  signOutTime: string | null;
  signAddress: string | null;
  /** 原始 GPS 坐标 "lng,lat"（高德地图跳转/距离分析用） */
  signLocation: string | null;
  /** 拜访时长（单位：分钟） */
  duration: number | null;
  visitStatus: string | null;
  attachments: IAttachment[] | null;
  chargerId: string | null;
  chargerName: string | null;
  flowStatus: string | null;
  // 审计
  createdAt?: string;
  createdBy?: string | null;
  updatedAt?: string;
  updatedBy?: string | null;
  deletedAt?: string | null;
  version?: number;
}

/**
 * 拜访签到关联客户简要信息
 */
export interface IVisitRecordCustomerInfo {
  id: string;
  customerName: string;
  shortName: string | null;
}

/**
 * 拜访签到关联联系人简要信息
 */
export interface IVisitRecordContactInfo {
  id: string;
  contactName: string;
}

/**
 * 拜访签到 API 响应类型
 */
export interface IVisitRecordResponse extends IVisitRecord {
  customer?: IVisitRecordCustomerInfo;
  contact?: IVisitRecordContactInfo;
}

/**
 * 创建拜访签到接口契约
 */
export interface ICreateVisitRecord {
  customerId: string;
  contactId: string;
  visitType: string;
  content: string;
  signInTime: string;
  signOutTime?: string | null;
  signAddress: string;
  signLocation?: string | null;
  duration?: number | null;
  visitStatus?: string | null;
  attachments: IAttachment[];
  chargerId: string;
}

/**
 * 更新拜访签到接口契约
 */
export type IUpdateVisitRecord = Partial<ICreateVisitRecord>;
