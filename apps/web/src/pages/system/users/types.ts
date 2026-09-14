import { createUserSchema } from '@ky-azeroth/shared/schemas/auth';
import type { ICreateUser, IUserResponse, Permission, Role } from '@ky-azeroth/shared/types/auth';
import { z } from 'zod';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface UserProfile extends IUserResponse {}

// 兼容旧代码
export type User = UserProfile;

export interface UserFormData extends Omit<
  ICreateUser,
  'avatar' | 'password' | 'phone' | 'email' | 'employeeId'
> {
  id?: string;
  phone?: string;
  email?: string;
  password?: string;
  employeeId?: string;
  version?: number;
}

export interface RoleForUser {
  id: string;
  code: string;
  name: string;
}

export interface EmployeeForUser {
  id: string;
  name: string;
  serialNumber: string;
}

export { Role };

export const userFormSchema = createUserSchema
  .extend({
    id: z.string().optional(),
    // 表单中 phone/email/employeeId 为空字符串而非 null，覆盖 shared 的 nullable
    phone: z
      .string()
      .regex(/^1[3-9]\d{9}$/, '请输入有效的手机号')
      .or(z.literal(''))
      .optional(),
    email: z.string().email('请输入正确的邮箱格式').or(z.literal('')).optional(),
    // 编辑时密码可选，覆盖 createUserSchema 中的必填规则
    password: z.string().optional(),
    roleIds: z.array(z.string()).min(1, '请选择至少一个角色'),
    employeeId: z.string().or(z.literal('')).optional(),
  })
  .superRefine((data, ctx) => {
    // 创建模式：密码必填且至少8个字符
    if (!data.id) {
      if (!data.password || data.password.length < 8) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: '密码至少8个字符',
          path: ['password'],
        });
      } else if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(data.password)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: '密码必须包含大小写字母和数字',
          path: ['password'],
        });
      }
    } else if (data.password && data.password.length > 0) {
      // 编辑模式：如果填写了密码，则验证
      if (data.password.length < 8) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: '密码至少8个字符',
          path: ['password'],
        });
      } else if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(data.password)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: '密码必须包含大小写字母和数字',
          path: ['password'],
        });
      }
    }
  });

export function toUserFormData(user: User): UserFormData {
  return {
    id: user.id,
    username: user.username,
    phone: user.phone || '',
    email: user.email || '',
    password: '',
    employeeId: user.employee?.id || '',
    roleIds: user.roles.map((r) => r.id),
    version: user.version,
  };
}

/**
 * 数据转换函数：表单数据 -> API 提交格式
 */
export function toUserPayload(form: UserFormData) {
  return {
    username: form.username.trim(),
    phone: form.phone?.trim() || null,
    email: form.email?.trim() || null,
    password: form.password || undefined,
    employeeId: form.employeeId || null,
    roleIds: form.roleIds,
    version: form.version,
  };
}

/**
 * 用于处理后端可能返回的嵌套 roles 结构
 */
interface RoleOrNested {
  id: string;
  name: string;
  code: string;
  description?: string;
  permissions?: Permission[];
  status?: 'active' | 'disabled';
  role?: {
    id: string;
    name: string;
    code: string;
    description?: string;
    permissions?: Permission[];
    status?: 'active' | 'disabled';
  };
}

/**
 * 数据转换函数：API响应 -> 前端展示对象
 */
export function toUserProfile(response: IUserResponse): UserProfile {
  return {
    ...response,
    roles:
      (response.roles as RoleOrNested[] | undefined)?.map((r) => {
        const roleData = r.role || r;
        return {
          id: roleData.id,
          name: roleData.name,
          code: roleData.code,
          description: roleData.description,
          permissions: roleData.permissions || [],
          status: roleData.status || 'active',
        } as Role;
      }) ?? [],
  };
}
