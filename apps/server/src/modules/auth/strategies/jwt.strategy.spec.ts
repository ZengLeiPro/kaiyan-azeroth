import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { vi } from 'vitest';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  const mockPrisma = {
    employee: { findUnique: vi.fn() },
    session: { findUnique: vi.fn() },
    userRole: { findMany: vi.fn() },
  };
  const payload = {
    sub: 'emp-123',
    eid: 'emp-123',
    username: 'testuser',
    roles: ['admin'],
    tokenType: 'access',
    jti: 'session-123',
    iat: Math.floor(Date.now() / 1000) - 1,
    auth_time: Math.floor(Date.now() / 1000) - 120,
  };
  const employee = {
    id: 'emp-123',
    username: 'testuser',
    loginStatus: 'active',
    canLogin: true,
    deletedAt: null,
    dingtalkUserId: null,
    tokenInvalidAfter: null,
  };
  const session = {
    employeeId: 'emp-123',
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.employee.findUnique.mockResolvedValue(employee);
    mockPrisma.session.findUnique.mockResolvedValue(session);
    mockPrisma.userRole.findMany.mockResolvedValue([{ role: { code: 'admin' } }]);
    strategy = new JwtStrategy(
      mockPrisma as unknown as PrismaService,
      {
        get: vi.fn().mockReturnValue('secret'),
      } as unknown as ConfigService
    );
  });

  it('accepts an access token only when Employee and its jti Session are active', async () => {
    await expect(strategy.validate(payload)).resolves.toEqual({
      id: 'emp-123',
      username: 'testuser',
      roles: ['admin'],
      employeeId: 'emp-123',
      dingtalkUserId: undefined,
      sessionId: 'session-123',
      authType: 'jwt',
      authenticatedAt: new Date(payload.auth_time * 1000),
    });
    expect(mockPrisma.session.findUnique).toHaveBeenCalledWith({
      where: { id: 'session-123' },
      select: { employeeId: true, expiresAt: true },
    });
  });

  it.each([
    [{ ...payload, jti: undefined }, '缺 jti'],
    [{ ...payload, iat: undefined }, '缺 iat'],
    [{ ...payload, iat: Number.NaN }, '无效 iat'],
    [{ ...payload, auth_time: undefined }, '缺 auth_time'],
    [{ ...payload, tokenType: undefined }, '缺 tokenType'],
    [{ ...payload, tokenType: 'refresh' }, 'refresh token'],
  ])('rejects legacy or non-access payload: %s (%s)', async (candidate, _label) => {
    await expect(strategy.validate(candidate)).rejects.toThrow(UnauthorizedException);
    expect(mockPrisma.employee.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a deleted Session immediately', async () => {
    mockPrisma.session.findUnique.mockResolvedValue(null);
    await expect(strategy.validate(payload)).rejects.toThrow('会话已失效');
  });

  it('rejects a Session owned by another Employee or already expired', async () => {
    mockPrisma.session.findUnique.mockResolvedValueOnce({ ...session, employeeId: 'emp-other' });
    await expect(strategy.validate(payload)).rejects.toThrow('会话已失效');

    mockPrisma.session.findUnique.mockResolvedValueOnce({
      ...session,
      expiresAt: new Date('2020-01-01T00:00:00.000Z'),
    });
    await expect(strategy.validate(payload)).rejects.toThrow('会话已失效');
  });

  it('uses <= at the same-second tokenInvalidAfter boundary', async () => {
    mockPrisma.employee.findUnique.mockResolvedValue({
      ...employee,
      tokenInvalidAfter: new Date(payload.iat * 1000),
    });
    await expect(strategy.validate(payload)).rejects.toThrow('令牌已被强制失效');
  });

  it('rejects split sub/eid identities before any DB lookup', async () => {
    await expect(strategy.validate({ ...payload, eid: 'emp-other' })).rejects.toThrow(
      '无效的访问令牌'
    );
    await expect(strategy.validate({ ...payload, eid: undefined })).rejects.toThrow(
      '无效的访问令牌'
    );
    expect(mockPrisma.employee.findUnique).not.toHaveBeenCalled();
  });

  it('rejects iat more than 30 seconds in the future but accepts the clock-skew boundary', async () => {
    const now = Math.floor(Date.now() / 1000);
    await expect(strategy.validate({ ...payload, iat: now + 32 })).rejects.toThrow(
      '无效的访问令牌'
    );
    await expect(strategy.validate({ ...payload, iat: now + 30 })).resolves.toEqual(
      expect.objectContaining({ employeeId: 'emp-123' })
    );
  });

  it('rejects invalid auth_time and returns it as authenticatedAt when valid', async () => {
    const now = Math.floor(Date.now() / 1000);
    await expect(strategy.validate({ ...payload, iat: now, auth_time: now + 31 })).rejects.toThrow(
      '无效的访问令牌'
    );
    await expect(strategy.validate({ ...payload, iat: now - 1, auth_time: now })).rejects.toThrow(
      '无效的访问令牌'
    );
    await expect(
      strategy.validate({ ...payload, iat: now, auth_time: now - 300 })
    ).resolves.toEqual(expect.objectContaining({ authenticatedAt: new Date((now - 300) * 1000) }));
  });

  it('does not let another instance disable an Employee between requests', async () => {
    await strategy.validate(payload);
    mockPrisma.employee.findUnique.mockResolvedValueOnce({
      ...employee,
      loginStatus: 'disabled',
      canLogin: false,
    });

    await expect(strategy.validate(payload)).rejects.toThrow('无效的令牌');
    expect(mockPrisma.employee.findUnique).toHaveBeenCalledTimes(2);
  });

  it('observes a multi-instance role revocation from shared DB on the next request', async () => {
    await expect(strategy.validate(payload)).resolves.toEqual(
      expect.objectContaining({ roles: ['admin'] })
    );
    mockPrisma.userRole.findMany.mockResolvedValueOnce([]);
    await expect(strategy.validate(payload)).resolves.toEqual(
      expect.objectContaining({ roles: [] })
    );

    expect(mockPrisma.session.findUnique).toHaveBeenCalledTimes(2);
    expect(mockPrisma.userRole.findMany).toHaveBeenCalledTimes(2);
    expect(mockPrisma.userRole.findMany).toHaveBeenLastCalledWith({
      where: {
        employeeId: 'emp-123',
        role: { deletedAt: null, status: 'active' },
      },
      select: { role: { select: { code: true } } },
    });
  });
});
