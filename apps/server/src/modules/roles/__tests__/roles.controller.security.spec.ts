import { describe, expect, it } from 'vitest';

import { FRESH_JWT_KEY } from '../../auth/decorators/fresh-jwt.decorator';
import { PERMISSION_KEY } from '../../auth/decorators/require-permission.decorator';
import { RolesController } from '../roles.controller';

describe('RolesController 高权限边界', () => {
  it.each(['create', 'update', 'remove'] as const)('%s 要求 RBAC + fresh JWT', (method) => {
    expect(Reflect.getMetadata(FRESH_JWT_KEY, RolesController.prototype[method])).toBe(true);
    expect(Reflect.getMetadata(PERMISSION_KEY, RolesController.prototype[method])).toEqual(
      expect.objectContaining({ module: 'system', menu: 'user_role' })
    );
  });

  it.each(['findAll', 'findOne'] as const)('%s 只要求查看权限', (method) => {
    expect(Reflect.getMetadata(FRESH_JWT_KEY, RolesController.prototype[method])).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, RolesController.prototype[method])).toEqual({
      module: 'system',
      menu: 'user_role',
      action: 'view',
    });
  });
});
