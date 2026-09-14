import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { afterEach, vi } from 'vitest';

import { FRESH_JWT_KEY } from '../decorators/fresh-jwt.decorator';
import { FreshJwtGuard } from './fresh-jwt.guard';

const EMPLOYEE_ID = '4d787670-64f2-49f0-a06e-8f480fb32c85';

function context(user: Record<string, unknown> | undefined): ExecutionContext {
  return {
    getHandler: () => function protectedHandler() {},
    getClass: () => class ProtectedController {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('FreshJwtGuard', () => {
  const reflector = {
    getAllAndOverride: vi.fn().mockReturnValue(true),
  } as unknown as Reflector;

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('accepts any employee with a fresh JWT', () => {
    const guard = new FreshJwtGuard(reflector);
    expect(
      guard.canActivate(
        context({
          id: EMPLOYEE_ID,
          employeeId: EMPLOYEE_ID,
          username: 'someone',
          authType: 'jwt',
          authenticatedAt: new Date(),
        })
      )
    ).toBe(true);
  });

  it('rejects PAT even with a matching employee', () => {
    const guard = new FreshJwtGuard(reflector);
    expect(() =>
      guard.canActivate(
        context({
          id: EMPLOYEE_ID,
          employeeId: EMPLOYEE_ID,
          username: 'someone',
          authType: 'pat',
        })
      )
    ).toThrow(ForbiddenException);
  });

  it('rejects JWT older than five minutes', () => {
    const guard = new FreshJwtGuard(reflector);
    expect(() =>
      guard.canActivate(
        context({
          id: EMPLOYEE_ID,
          employeeId: EMPLOYEE_ID,
          authType: 'jwt',
          authenticatedAt: new Date(Date.now() - 6 * 60 * 1000),
        })
      )
    ).toThrow(ForbiddenException);
  });

  it('does not apply to handlers without FreshJwt metadata', () => {
    const openReflector = {
      getAllAndOverride: vi
        .fn()
        .mockImplementation((key: string) => (key === FRESH_JWT_KEY ? undefined : undefined)),
    } as unknown as Reflector;
    expect(new FreshJwtGuard(openReflector).canActivate(context(undefined))).toBe(true);
  });
});
