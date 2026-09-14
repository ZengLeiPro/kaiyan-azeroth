import { createDepartmentSchema } from '@ky-azeroth/shared/schemas/department';
import type { ICreateDepartment, IDepartmentResponse } from '@ky-azeroth/shared/types/department';

/**
 * 部门前端展示类型（强绑定 IDepartmentResponse）
 */
export interface DepartmentProfile extends IDepartmentResponse {
  /** 父部门名称（前端扩展字段） */
  parentName?: string;
}

/**
 * 部门表单数据类型
 */
export interface DepartmentFormData extends ICreateDepartment {
  version?: number;
}

/**
 * 部门表单校验 Schema（直接使用 shared）
 */
export const departmentFormSchema = createDepartmentSchema;

/**
 * API 响应 -> 前端展示
 */
export function toDepartmentProfile(data: IDepartmentResponse): DepartmentProfile {
  return {
    ...data,
    parentName: data.parent?.name || undefined,
  };
}

/**
 * 展示/响应 -> 表单数据
 */
export function toDepartmentFormData(entity: DepartmentProfile): DepartmentFormData {
  return {
    name: entity.name,
    parentId: entity.parentId ?? null,
    sortOrder: entity.sortOrder,
    managerId: entity.managerId ?? null,
    status: entity.status,
    version: entity.version,
  };
}

/**
 * 表单 -> API payload
 */
export function toDepartmentPayload(form: DepartmentFormData) {
  return {
    name: form.name.trim(),
    parentId: form.parentId ?? null,
    sortOrder: form.sortOrder,
    managerId: form.managerId ?? null,
    status: form.status,
    version: form.version,
  };
}
