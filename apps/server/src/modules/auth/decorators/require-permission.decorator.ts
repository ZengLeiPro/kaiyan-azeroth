import type { PermissionActionKey } from '@ky-azeroth/shared';
import { SetMetadata } from '@nestjs/common';

export interface RequiredPermission {
  module: string;
  menu: string;
  action: PermissionActionKey;
}

export const PERMISSION_KEY = 'requiredPermission';

/**
 * 声明接口所需的权限
 *
 * @example
 * ```typescript
 * @RequirePermission({ module: 'crm', menu: 'customers', action: 'delete' })
 * @Delete(':id')
 * remove(@Param('id') id: string) { ... }
 * ```
 */
export type RequiredPermissionConfig = RequiredPermission | RequiredPermission[];

export const RequirePermission = (permission: RequiredPermission) =>
  SetMetadata(PERMISSION_KEY, permission);

/** 声明接口满足任一权限即可访问（用于多个菜单共享同一后端资源的场景）。 */
export const RequireAnyPermission = (permissions: RequiredPermission[]) =>
  SetMetadata(PERMISSION_KEY, permissions);
