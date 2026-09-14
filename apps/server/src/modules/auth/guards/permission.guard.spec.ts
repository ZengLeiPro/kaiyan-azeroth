import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { describe, expect, it, vi } from 'vitest';

import { ALLOW_ANY_AUTHENTICATED_KEY } from '../decorators/allow-any-authenticated.decorator';
import { PermissionGuard } from './permission.guard';

function context(): ExecutionContext {
  return new ExecutionContextHost([], class Controller {}, function handler() {});
}

describe('PermissionGuard 路由元数据默认拒绝', () => {
  it('未声明任何授权元数据时 fail-closed', async () => {
    const reflector = { getAllAndOverride: vi.fn(() => undefined) };
    const guard = new PermissionGuard(reflector as never, {} as never);

    await expect(guard.canActivate(context())).rejects.toThrow(ForbiddenException);
  });

  it('显式 AllowAnyAuthenticatedUser 时交给认证守卫处理', async () => {
    const reflector = {
      getAllAndOverride: vi.fn((key: string) =>
        key === ALLOW_ANY_AUTHENTICATED_KEY ? true : undefined
      ),
    };
    const guard = new PermissionGuard(reflector as never, {} as never);

    await expect(guard.canActivate(context())).resolves.toBe(true);
  });
});
