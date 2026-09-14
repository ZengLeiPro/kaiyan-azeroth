import { ForbiddenException } from '@nestjs/common';

export type PermissionSlice = {
  module: string;
  menu: string;
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
  export: boolean;
  approve: boolean;
  viewScope: string;
};

export type ActorPermissionFlags = {
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
  export: boolean;
  approve: boolean;
  viewAll: boolean;
};

const ACTIONS = ['view', 'create', 'edit', 'delete', 'export', 'approve'] as const;

export function mergePermissionSlices(
  permissions: PermissionSlice[]
): Map<string, ActorPermissionFlags> {
  const actorPermissions = new Map<string, ActorPermissionFlags>();
  for (const permission of permissions) {
    const key = `${permission.module}:${permission.menu}`;
    const existing = actorPermissions.get(key);
    actorPermissions.set(key, {
      view: Boolean(existing?.view || permission.view),
      create: Boolean(existing?.create || permission.create),
      edit: Boolean(existing?.edit || permission.edit),
      delete: Boolean(existing?.delete || permission.delete),
      export: Boolean(existing?.export || permission.export),
      approve: Boolean(existing?.approve || permission.approve),
      viewAll: Boolean(existing?.viewAll || permission.viewScope === 'ALL'),
    });
  }
  return actorPermissions;
}

export function assertPermissionsWithinActorScope(
  requested: PermissionSlice[],
  actorPermissions: Map<string, ActorPermissionFlags>,
  message = '不能配置超出当前账号权限范围的权限'
): void {
  for (const permission of requested) {
    const owned = actorPermissions.get(`${permission.module}:${permission.menu}`);
    if (
      ACTIONS.some((action) => permission[action] && !owned?.[action]) ||
      (permission.viewScope === 'ALL' && !owned?.viewAll)
    ) {
      throw new ForbiddenException(message);
    }
  }
}
