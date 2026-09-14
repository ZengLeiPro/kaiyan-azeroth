/**
 * 员工离职记录实体（只读，来自钉钉同步）
 *
 * 该类型对应 EmployeeLeave 模型，数据由钉钉同步写入，业务层只读。
 * 不提供 ICreate/IUpdate 类型。
 */
export interface IEmployeeLeave {
  id: string;
  dingtalkUserId: string;
  name: string;
  mobile?: string | null;
  leaveTime?: string | null;
  leaveReason?: string | null;
  syncedAt?: string | null;
}

/**
 * 员工离职记录 API 响应类型
 */

export interface IEmployeeLeaveResponse extends IEmployeeLeave {}
