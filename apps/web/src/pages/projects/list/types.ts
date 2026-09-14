import { createProjectSchema } from '@ky-azeroth/shared/schemas/project';
import type { ICreateProject, IProjectResponse } from '@ky-azeroth/shared/types/project';
import { z } from 'zod';

/**
 * 项目前端展示类型（强绑定 IProjectResponse）
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ProjectProfile extends IProjectResponse {}

/**
 * 项目表单数据类型
 */
export interface ProjectFormData extends ICreateProject {
  version?: number;
}

/**
 * 项目表单校验 Schema（在 shared schema 基础上对前端表单收紧必填）。
 * 状态/分类/负责人/客户在新增与编辑表单中均为必填。
 * shared schema 保留宽松定义不动，避免影响其他调用方（CLI/import 等）。
 *
 * 注意：CustomerSelect / EmployeeSelect 清空时回写 null，因此用 invalid_type_error
 * 覆盖默认的 "Expected string, received null"，保持错误文案友好统一。
 */
const requiredField = (msg: string) =>
  z.string({ required_error: msg, invalid_type_error: msg }).min(1, msg);

export const projectFormSchema = createProjectSchema.extend({
  status: requiredField('请选择状态'),
  category: requiredField('请选择分类'),
  customerId: requiredField('请选择客户').uuid('请选择客户'),
  ownerId: requiredField('请选择负责人'),
});

/**
 * API 响应 -> 前端展示
 */
export function toProjectProfile(data: IProjectResponse): ProjectProfile {
  return {
    ...data,
  };
}

/**
 * 展示/响应 -> 表单数据
 */
export function toProjectFormData(entity: ProjectProfile): ProjectFormData {
  return {
    name: entity.name,
    description: entity.description ?? null,
    status: entity.status ?? undefined,
    category: entity.category ?? null,
    customerId: entity.customerId ?? null,
    opportunityId: entity.opportunityId ?? null,
    saleOrderId: entity.saleOrderId ?? null,
    ownerId: entity.ownerId ?? null,
    version: entity.version,
  };
}

/**
 * 表单 -> API payload
 */
export function toProjectPayload(form: ProjectFormData) {
  return {
    name: form.name.trim(),
    description: form.description ?? null,
    status: form.status ?? undefined,
    category: form.category ?? null,
    customerId: form.customerId ?? null,
    opportunityId: form.opportunityId ?? null,
    saleOrderId: form.saleOrderId ?? null,
    ownerId: form.ownerId ?? null,
    version: form.version,
  };
}
