import { useAuthStore } from '@/stores/auth';

export type PermissionAction = 'view' | 'create' | 'edit' | 'delete' | 'export' | 'approve';
export type ViewScope = 'SELF' | 'ALL';

/**
 * 检查当前登录用户是否对指定 (module, menu, action) 拥有权限,可选附带 scope 判定。
 *
 * - ADMIN 角色:同样遵循 system/roles 页面配置
 * - scope=undefined:仅判断 action 是否授权
 * - scope='ALL':需要至少一个角色对该菜单的 viewScope === 'ALL'
 * - scope='SELF':任意 viewScope(SELF/ALL)均满足(ALL 自然包含 SELF)
 *
 * 多角色取最大范围:任一角色满足条件即返回 true。
 */
export function useHasPermission(
  module: string,
  menu: string,
  action: PermissionAction,
  scope?: ViewScope
): boolean {
  const user = useAuthStore((s) => s.user);
  if (!user) return false;
  return user.roles.some((role) =>
    role.permissions?.some(
      (p) =>
        p.module === module &&
        p.menu === menu &&
        p[action] === true &&
        (scope === undefined ||
          p.viewScope === scope ||
          (scope === 'SELF' && p.viewScope === 'ALL'))
    )
  );
}
