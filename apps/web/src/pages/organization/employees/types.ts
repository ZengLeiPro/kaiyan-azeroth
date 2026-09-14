import { createEmployeeSchema } from '@ky-azeroth/shared/schemas/employee';
import type { ICreateEmployee, IEmployeeResponse } from '@ky-azeroth/shared/types/employee';
import { formatDateString, toAPIDateString } from '@ky-azeroth/shared/utils';

/**
 * 员工前端展示类型（强绑定 IEmployeeResponse）
 */
export interface EmployeeProfile extends IEmployeeResponse {
  /** 主部门名称（前端扩展字段） */
  departmentName?: string;
  /** 所属部门名称汇总（前端扩展字段） */
  departmentNames?: string;
}

/**
 * 员工表单数据类型
 */
export interface EmployeeFormData extends ICreateEmployee {
  version?: number;
}

/**
 * 员工表单校验 Schema（直接使用 shared）
 */
export const employeeFormSchema = createEmployeeSchema;

function normalizeDateOnly(value: string | null | undefined): string | null {
  const formatted = formatDateString(value);
  return formatted || null;
}

/**
 * API 响应 -> 前端展示
 */
export function toEmployeeProfile(data: IEmployeeResponse): EmployeeProfile {
  return {
    ...data,
    entryDate: normalizeDateOnly(data.entryDate),
    hourlyRate: data.hourlyRate != null ? Number(data.hourlyRate) : null,
    departmentName: data.primaryDepartment?.departmentName ?? undefined,
    departmentNames: data.departments?.map((d) => d.departmentName).join(', ') ?? undefined,
  };
}

/**
 * 展示/响应 -> 表单数据
 */
export function toEmployeeFormData(entity: EmployeeProfile): EmployeeFormData {
  return {
    name: entity.name,
    phone: entity.phone ?? null,
    email: entity.email ?? null,
    gender: entity.gender ?? null,
    entryDate: normalizeDateOnly(entity.entryDate),
    position: entity.position ?? null,
    hourlyRate: entity.hourlyRate != null ? Number(entity.hourlyRate) : null,
    status: entity.status,
    avatar: entity.avatar ?? null,
    departmentIds: entity.departments?.map((d) => d.departmentId) ?? [],
    primaryDepartmentId: entity.primaryDepartment?.departmentId ?? null,
    version: entity.version,
  };
}

/**
 * 表单 -> API payload
 */
export function toEmployeePayload(form: EmployeeFormData) {
  return {
    name: form.name.trim(),
    phone: form.phone ?? null,
    email: form.email ?? null,
    gender: form.gender ?? null,
    entryDate: toAPIDateString(form.entryDate),
    position: form.position ?? null,
    hourlyRate: form.hourlyRate != null ? String(form.hourlyRate) : null,
    status: form.status,
    avatar: form.avatar ?? null,
    departmentIds: form.departmentIds ?? [],
    primaryDepartmentId: form.primaryDepartmentId ?? null,
    version: form.version,
  };
}
