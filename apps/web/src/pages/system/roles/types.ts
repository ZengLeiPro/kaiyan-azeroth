import {
  MODULE_PERMISSION_ACTIONS,
  MODULES,
  PERMISSION_ACTIONS,
  type PermissionActionKey,
} from '@ky-azeroth/shared/constants';
import { roleFormSchema } from '@ky-azeroth/shared/schemas/auth';
import type { ICreateRole, IRoleResponse, Permission, Role } from '@ky-azeroth/shared/types/auth';
import { z } from 'zod';

// Re-export shared types
export type { Role };
export { roleFormSchema };
export type PermissionAction = PermissionActionKey;

export interface RoleProfile extends IRoleResponse {
  userIds: string[];
  userCount: number; // 强制非 undefined（IRoleResponse 中为 optional，toRoleProfile 保证有默认值）
}

const configurableMenuKeys = new Set(
  Object.entries(MODULES).flatMap(([moduleKey, module]) =>
    Object.keys(module.menus).map((menuKey) => `${moduleKey}:${menuKey}`)
  )
);

// 从 shared MODULES 自动派生，而不是从侧边栏 menuGroups 派生。
// 这样即使某个权限没有独立侧边栏入口（如 finance.payroll_import / finance.pnl），
// 也会在 system/roles 权限矩阵中显示出来。
export const permissionModules = Object.entries(MODULES).map(([moduleKey, module]) => {
  const menus = Object.entries(module.menus).map(([menuKey, menu]) => ({
    key: menuKey,
    name: menu.label,
    permissions: [...(MODULE_PERMISSION_ACTIONS[moduleKey]?.[menuKey] ?? ['view'])],
  }));

  return {
    key: moduleKey,
    name: module.label,
    permissions: Array.from(new Set(menus.flatMap((menu) => menu.permissions))),
    menus,
  };
});

export const permissionLabels: Record<PermissionActionKey, string> = Object.fromEntries(
  Object.entries(PERMISSION_ACTIONS).map(([key, action]) => [key, action.label])
) as Record<PermissionActionKey, string>;

// Form Data Type - Frontend specific (permissions as flattened strings)
export type RoleFormData = z.input<typeof roleFormSchema>;

/**
 * Convert Backend Entity to Frontend Form Data
 * Maps menu-level permissions to `module:menu:action` format strings
 */
export function toRoleFormData(role: IRoleResponse): RoleFormData {
  const formPermissions: string[] = [];
  const viewScopes: Record<string, 'SELF' | 'ALL'> = {};

  if (role.permissions) {
    role.permissions.forEach((p) => {
      const menuKey = `${p.module}:${p.menu}`;
      if (!configurableMenuKeys.has(menuKey)) return;

      const actions = MODULE_PERMISSION_ACTIONS[p.module]?.[p.menu] ?? [];
      actions.forEach((action) => {
        if (p[action] === true) {
          formPermissions.push(`${menuKey}:${action}`);
        }
      });
      // 收集 viewScope（按 'module:menu' 作 key）
      viewScopes[menuKey] = p.viewScope ?? 'SELF';
    });
  }

  return {
    code: role.code,
    name: role.name,
    description: role.description || '',
    permissions: formPermissions,
    viewScopes,
    userIds: role.userIds ?? [],
  };
}

/**
 * Convert Frontend Form Data to Backend Payload
 * Aggregates `module:menu:action` strings into menu-level Permission objects
 */
export function toRolePayload(form: RoleFormData): ICreateRole {
  // 按 module:menu 聚合动作
  const permMap = new Map<string, Permission>();

  form.permissions.forEach((permKey) => {
    const parts = permKey.split(':');
    if (parts.length !== 3) return;
    const module = parts[0]!;
    const menu = parts[1]!;
    const action = parts[2]! as PermissionActionKey;
    const mapKey = `${module}:${menu}`;
    if (!configurableMenuKeys.has(mapKey)) return;

    const validActions = MODULE_PERMISSION_ACTIONS[module]?.[menu] ?? [];

    if (!permMap.has(mapKey)) {
      permMap.set(mapKey, {
        module,
        menu,
        view: false,
        create: false,
        edit: false,
        delete: false,
        export: false,
        approve: false,
        viewScope: form.viewScopes?.[mapKey] ?? 'SELF',
      });
    }

    const perm = permMap.get(mapKey)!;
    if (validActions.includes(action)) {
      perm[action] = true;
    }
  });

  return {
    code: form.code,
    name: form.name,
    description: form.description || undefined,
    userIds: form.userIds ?? [],
    // 过滤掉没勾任何 action 的记录(UI 应禁止,但这里兜底)
    permissions: Array.from(permMap.values()).filter(
      (p) => p.view || p.create || p.edit || p.delete || p.export || p.approve
    ),
  };
}

/**
 * 数据转换函数：API响应 -> 前端展示对象
 */
export function toRoleProfile(role: IRoleResponse): RoleProfile {
  return {
    ...role,
    userIds: role.userIds ?? [],
    userCount: role.userCount ?? 0,
  };
}
