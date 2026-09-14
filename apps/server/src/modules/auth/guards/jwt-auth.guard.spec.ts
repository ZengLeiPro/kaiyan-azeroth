import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { PatService } from '../services/pat.service';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard PAT authorization', () => {
  const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) };
  const patService = {
    isPatToken: vi.fn().mockReturnValue(true),
    verify: vi.fn().mockResolvedValue({ employeeId: 'emp-1', patId: 'pat-1' }),
  };
  const prisma = { employee: { findUnique: vi.fn() } };
  let guard: JwtAuthGuard;

  function contextFor(request: Record<string, unknown>): ExecutionContext {
    return {
      getHandler: vi.fn(),
      getClass: vi.fn(),
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    reflector.getAllAndOverride.mockReturnValue(false);
    patService.isPatToken.mockReturnValue(true);
    patService.verify.mockResolvedValue({ employeeId: 'emp-1', patId: 'pat-1' });
    prisma.employee.findUnique.mockResolvedValue({
      id: 'emp-1',
      username: 'tester',
      loginStatus: 'active',
      canLogin: true,
      deletedAt: null,
      dingtalkUserId: null,
      userRoles: [{ role: { code: 'admin' } }],
    });
    guard = new JwtAuthGuard(
      reflector as unknown as Reflector,
      patService as unknown as PatService,
      prisma as unknown as PrismaService
    );
  });

  it('queries only active, non-deleted roles for PAT authorization', async () => {
    const request = { headers: { authorization: 'Bearer pat_test_token' } };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);

    expect(prisma.employee.findUnique).toHaveBeenCalledWith({
      where: { id: 'emp-1' },
      select: {
        id: true,
        username: true,
        loginStatus: true,
        canLogin: true,
        deletedAt: true,
        dingtalkUserId: true,
        userRoles: {
          where: { role: { deletedAt: null, status: 'active' } },
          select: { role: { select: { code: true } } },
        },
      },
    });
    expect(request).toEqual(
      expect.objectContaining({ user: expect.objectContaining({ roles: ['admin'] }) })
    );
  });

  it('observes PAT role revocation from shared DB on the next request', async () => {
    const first = { headers: { authorization: 'Bearer pat_test_token' } };
    const second = { headers: { authorization: 'Bearer pat_test_token' } };

    await guard.canActivate(contextFor(first));
    prisma.employee.findUnique.mockResolvedValueOnce({
      id: 'emp-1',
      username: 'tester',
      loginStatus: 'active',
      canLogin: true,
      deletedAt: null,
      dingtalkUserId: null,
      userRoles: [],
    });
    await guard.canActivate(contextFor(second));

    expect(prisma.employee.findUnique).toHaveBeenCalledTimes(2);
    expect(second).toEqual(
      expect.objectContaining({ user: expect.objectContaining({ roles: [] }) })
    );
  });

  it('still rejects a PAT whose Employee is disabled', async () => {
    prisma.employee.findUnique.mockResolvedValueOnce({
      id: 'emp-1',
      username: 'tester',
      loginStatus: 'disabled',
      canLogin: false,
      deletedAt: null,
      dingtalkUserId: null,
      userRoles: [],
    });

    await expect(
      guard.canActivate(contextFor({ headers: { authorization: 'Bearer pat_test_token' } }))
    ).rejects.toThrow(UnauthorizedException);
  });
});
