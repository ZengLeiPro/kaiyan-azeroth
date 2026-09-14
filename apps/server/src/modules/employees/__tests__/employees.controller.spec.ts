import { type ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FRESH_JWT_KEY } from '../../auth/decorators/fresh-jwt.decorator';
import { IS_PUBLIC_KEY } from '../../auth/decorators/public.decorator';
import { PERMISSION_KEY } from '../../auth/decorators/require-permission.decorator';
import { FreshJwtGuard } from '../../auth/guards/fresh-jwt.guard';
import { PermissionGuard } from '../../auth/guards/permission.guard';
import { EmployeesController } from '../employees.controller';

function handler(name: 'update' | 'remove' | 'bindDingtalk' | 'unbindDingtalk') {
  return EmployeesController.prototype[name];
}

const PROTECTED_ID = '9f1f2538-86b0-4b69-901d-fb6cc9d38d9a';

function employeeContext(
  method: 'update' | 'remove',
  user: Record<string, unknown>
): ExecutionContext {
  return {
    getHandler: () => handler(method),
    getClass: () => EmployeesController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function superAdminContext(
  method: 'bindDingtalk' | 'unbindDingtalk',
  employeeId: string,
  username: string
): ExecutionContext {
  return {
    getHandler: () => handler(method),
    getClass: () => EmployeesController,
    switchToHttp: () => ({
      getRequest: () => ({
        user: {
          id: employeeId,
          employeeId,
          username,
          roles: ['ADMIN'],
          authType: 'jwt',
          authenticatedAt: new Date(),
          permissions: ['organization:employees:edit'],
        },
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('EmployeesController DingTalk binding contract', () => {
  const service = {
    update: vi.fn(),
    remove: vi.fn(),
    bindDingtalk: vi.fn(),
    unbindDingtalk: vi.fn(),
  };
  const controller = new EmployeesController(service as never);

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPER_ADMIN_EMPLOYEE_ID = PROTECTED_ID;
  });

  it.each(['bindDingtalk', 'unbindDingtalk'] as const)(
    'marks %s as employees.edit plus fresh JWT',
    (method) => {
      expect(Reflect.getMetadata(FRESH_JWT_KEY, handler(method))).toBe(true);
      expect(Reflect.getMetadata(PERMISSION_KEY, handler(method))).toEqual({
        module: 'organization',
        menu: 'employees',
        action: 'edit',
      });
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler(method))).toBeUndefined();
    }
  );

  it.each([
    ['update', 'edit'],
    ['remove', 'delete'],
  ] as const)(
    'keeps ordinary %s on organization:employees:%s RBAC without fresh-JWT metadata',
    (method, action) => {
      expect(Reflect.getMetadata(PERMISSION_KEY, handler(method))).toEqual({
        module: 'organization',
        menu: 'employees',
        action,
      });
      expect(Reflect.getMetadata(FRESH_JWT_KEY, handler(method))).toBeUndefined();
    }
  );

  it.each(['update', 'remove'] as const)('rejects low-RBAC callers before %s', async (method) => {
    const guard = new PermissionGuard(new Reflector(), {
      rolePermission: { findMany: vi.fn().mockResolvedValue([]) },
    } as never);

    await expect(
      guard.canActivate(
        employeeContext(method, {
          id: 'employee-low-rbac',
          employeeId: 'employee-low-rbac',
          roles: ['EMPLOYEE'],
        })
      )
    ).rejects.toThrow(ForbiddenException);
  });

  it.each(['update', 'remove'] as const)(
    'rejects fresh PAT authentication before calling %s service',
    (method) => {
      const user = {
        id: 'employee-pat',
        username: 'pat-user',
        roles: ['ADMIN'],
        authType: 'pat' as const,
        authenticatedAt: new Date(),
      };

      expect(() =>
        method === 'update'
          ? controller.update('employee-target', {} as never, user)
          : controller.remove('employee-target', user)
      ).toThrow(ForbiddenException);
      expect(service[method]).not.toHaveBeenCalled();
    }
  );

  it.each(['update', 'remove'] as const)(
    'rejects an old JWT before calling %s service',
    (method) => {
      const user = {
        id: 'employee-jwt',
        username: 'jwt-user',
        roles: ['ADMIN'],
        authType: 'jwt' as const,
        authenticatedAt: new Date(Date.now() - 5 * 60 * 1000 - 1),
      };

      expect(() =>
        method === 'update'
          ? controller.update('employee-target', {} as never, user)
          : controller.remove('employee-target', user)
      ).toThrow(ForbiddenException);
      expect(service[method]).not.toHaveBeenCalled();
    }
  );

  it.each(['update', 'remove'] as const)(
    'allows a fresh ordinary JWT through %s after RBAC has passed',
    async (method) => {
      const user = {
        id: 'employee-editor',
        username: 'editor',
        roles: ['HR'],
        authType: 'jwt' as const,
        authenticatedAt: new Date(),
      };

      if (method === 'update') {
        await controller.update('employee-target', {} as never, user);
        expect(service.update).toHaveBeenCalledWith('employee-target', {}, user);
      } else {
        await controller.remove('employee-target', user);
        expect(service.remove).toHaveBeenCalledWith('employee-target', user);
      }
    }
  );

  it.each(['bindDingtalk', 'unbindDingtalk'] as const)(
    'rejects PAT on %s even with employees.edit metadata',
    (method) => {
      const guard = new FreshJwtGuard(new Reflector());
      const jwtContext = superAdminContext(method, '4d787670-64f2-49f0-a06e-8f480fb32c85', 'admin');
      expect(guard.canActivate(jwtContext)).toBe(true);
    }
  );

  it('forwards the complete bind body and actor to the service', async () => {
    const body = {
      version: 3,
      expectedDingtalkUserId: 'ding-user-old',
      expectedDingtalkUnionId: 'ding-union-old',
      dingtalkUserId: 'ding-user-new',
      dingtalkUnionId: 'ding-union-new',
    };
    const actor = { id: 'employee-admin', username: 'admin', roles: ['ADMIN'] };
    const response = { id: 'employee-target', version: 4 };
    service.bindDingtalk.mockResolvedValue(response);

    await expect(controller.bindDingtalk('employee-target', body as never, actor)).resolves.toBe(
      response
    );
    expect(service.bindDingtalk).toHaveBeenCalledWith('employee-target', body, actor);
  });

  it('forwards the versioned expected-pair unbind body and actor to the service', async () => {
    const body = {
      version: 7,
      expectedDingtalkUserId: 'ding-user-old',
      expectedDingtalkUnionId: 'ding-union-old',
    };
    const actor = { id: 'employee-admin', username: 'admin', roles: ['ADMIN'] };
    const response = { id: 'employee-target', version: 8 };
    service.unbindDingtalk.mockResolvedValue(response);

    await expect(controller.unbindDingtalk('employee-target', body as never, actor)).resolves.toBe(
      response
    );
    expect(service.unbindDingtalk).toHaveBeenCalledWith('employee-target', body, actor);
  });
});
