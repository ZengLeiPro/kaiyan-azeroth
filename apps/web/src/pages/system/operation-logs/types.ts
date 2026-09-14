import type {
  ILoginLogResponse,
  IOperationLogResponse,
  OperationLogChangeData,
} from '@ky-azeroth/shared/types/system';

/**
 * 操作日志前端展示类型
 *
 * 继承自 IOperationLogResponse，确保必要字段非空
 */
export interface OperationLogProfile extends IOperationLogResponse {
  operationType: string;
  operationDesc: string;
  operator: string;
  operatorName?: string;
  operatorUsername?: string;
  operatorId: string;
  operatorIp: string;
}

// 兼容旧代码
export type OperationLog = OperationLogProfile;

export interface LoginLogProfile extends ILoginLogResponse {
  employeeName?: string;
}

/** 导出变更数据类型供组件使用 */
export type { OperationLogChangeData };

export function toOperationLogProfile(response: IOperationLogResponse): OperationLogProfile {
  return {
    ...response,
    id: response.id,
    userId: response.userId ?? '',
    userName: response.userName,
    module: response.module,
    action: response.action,
    content: response.content,
    ipAddress: response.ipAddress,
    createdAt: response.createdAt,
    operationType: response.operationType ?? response.action,
    operationDesc: response.operationDesc ?? response.content,
    operator: response.operator ?? response.operatorName ?? response.userName ?? '',
    operatorName: response.operatorName,
    operatorUsername: response.operatorUsername,
    operatorId: response.operatorId ?? response.userId ?? '',
    operatorIp: response.operatorIp ?? response.ipAddress ?? '',
    targetId: response.targetId,
    targetName: response.targetName,
    beforeData: response.beforeData,
    afterData: response.afterData,
  };
}

export function toLoginLogProfile(response: ILoginLogResponse): LoginLogProfile {
  return {
    ...response,
    employeeName: response.employeeName,
  };
}

/**
 * 操作日志表单数据类型（只读模块，无需表单）
 */

export type OperationLogFormData = Record<string, never>;

/**
 * 数据转换函数：实体 -> 表单初始值
 *
 * 注意：操作日志为系统只读模块，仅用于查看历史操作记录，
 * 不支持用户编辑或创建。此函数返回空对象以满足类型规范要求。
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function toOperationLogFormData(_entity: OperationLog): OperationLogFormData {
  return {};
}

/**
 * 将表单数据转换为 API 提交格式
 * @description 操作日志为系统只读模块，仅用于查看历史操作记录，不支持用户编辑或创建。
 * 此函数仅用于满足类型规范要求。
 */
// @no-payload: 操作日志只读页面，数据由系统自动记录
export function toOperationLogPayload(form: OperationLogFormData): OperationLogFormData {
  return form;
}

export const moduleLabels: Record<string, string> = {
  customers: '客户管理',
  contacts: '联系人',
  opportunities: '商机',
  'sale-orders': '合同订单',
  payments: '回款管理',
  invoices: '开票管理',
  'keep-records': '跟进记录',
  'visit-records': '拜访签到',
  'crm-products': '产品管理',
  'purchase-orders': '采购订单',
  'purchase-inbound': '采购入库',
  'purchase-return': '采购退货',
  stores: '门店档案',
  warehouses: '仓库档案',
  products: '产品信息',
  suppliers: '供应商档案',
  employees: '员工档案',
  bom: '产品配方',
  'production-plans': '生产排产',
  'fixed-assets': '固定资产',
  users: '用户管理',
  roles: '角色权限',
  settings: '系统参数',
};

export const operationTypeColors: Record<string, string> = {
  create: 'bg-green-100 text-green-800',
  update: 'bg-blue-100 text-blue-800',
  delete: 'bg-red-100 text-red-800',
  approve: 'bg-purple-100 text-purple-800',
  reject: 'bg-orange-100 text-orange-800',
  submit: 'bg-yellow-100 text-yellow-800',
  claim: 'bg-amber-100 text-amber-800',
  restore: 'bg-green-100 text-green-800',
  'red-void': 'bg-red-100 text-red-800',
  'submit-approval': 'bg-yellow-100 text-yellow-800',
  'submit-refund': 'bg-yellow-100 text-yellow-800',
  'batch-transfer': 'bg-amber-100 text-amber-800',
  'batch-update': 'bg-blue-100 text-blue-800',
  'batch-delete': 'bg-red-100 text-red-800',
  'batch-add-collab': 'bg-blue-100 text-blue-800',
  'batch-remove-collab': 'bg-orange-100 text-orange-800',
  'permanent-delete': 'bg-red-100 text-red-800',
};

export const operationTypeLabels: Record<string, string> = {
  create: '新建',
  update: '修改',
  delete: '删除',
  approve: '审批通过',
  reject: '审批驳回',
  submit: '提交审批',
  claim: '认领',
  restore: '恢复',
  'red-void': '冲红',
  'submit-approval': '提交审批',
  'submit-refund': '提交退款审批',
  'batch-transfer': '批量转交',
  'batch-update': '批量编辑',
  'batch-delete': '批量删除',
  'batch-add-collab': '批量加协作人',
  'batch-remove-collab': '批量移除协作人',
  'permanent-delete': '永久删除',
};
