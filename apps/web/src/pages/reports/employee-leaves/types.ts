import type { IEmployeeLeaveResponse } from '@ky-azeroth/shared/types/employee-leave';

// @no-payload: 只读页面，数据来自钉钉同步
// @no-formdata-needed: 只读展示页面

/**
 * 员工离职记录前端展示类型（强绑定 IEmployeeLeaveResponse）
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface EmployeeLeaveProfile extends IEmployeeLeaveResponse {}

/**
 * 员工离职记录表单数据（只读页面，无表单）
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface EmployeeLeaveFormData {}

/**
 * API 响应 -> 前端展示
 */
export function toEmployeeLeaveProfile(data: IEmployeeLeaveResponse): EmployeeLeaveProfile {
  return {
    ...data,
  };
}

/**
 * 展示/响应 -> 表单数据（只读页面）
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function toEmployeeLeaveFormData(_profile: EmployeeLeaveProfile): EmployeeLeaveFormData {
  return {};
}
