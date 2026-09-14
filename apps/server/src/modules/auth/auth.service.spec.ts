import { ForbiddenException, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import axios from 'axios';
import * as bcrypt from 'bcryptjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EmployeePermissionCacheService } from '../../common/services/employee-permission-cache.service';
import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../test/prisma-mock.factory';
import { DingtalkAuth } from '../dingtalk-core/dingtalk-auth.service';
import { SessionsService } from '../sessions/sessions.service';
import { AuthService } from './auth.service';
import { assertFreshJwtAuthentication } from './guards/fresh-jwt-authentication';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------
vi.mock('bcryptjs', () => ({
  compare: vi.fn(),
  hash: vi.fn().mockResolvedValue('hashed-password'),
}));

vi.mock('bowser', () => ({
  default: {
    parse: () => ({
      browser: { name: 'Chrome', version: '120' },
      os: { name: 'macOS', version: '14' },
      platform: { type: 'desktop', vendor: undefined, model: undefined },
    }),
  },
}));

// ---------------------------------------------------------------------------
// Helpers — push 6: 直接 mock employee 而非 user
// ---------------------------------------------------------------------------
function buildMockEmployee(overrides: Record<string, unknown> = {}) {
  return {
    id: 'emp-1',
    name: 'Test Employee',
    serialNumber: 'EMP_TEST_1',
    username: 'testuser',
    phone: null,
    email: null,
    avatar: null,
    password: 'hashed-pw',
    canLogin: true,
    loginStatus: 'active',
    loginFailCount: 0,
    lockUntil: null,
    deletedAt: null,
    lastLoginAt: null,
    lastLoginIp: null,
    tokenInvalidAfter: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
    isAdmin: false,
    isBoss: false,
    isLeader: false,
    dingtalkActive: true,
    dingtalkUserId: null,
    dingtalkUnionId: null,
    userRoles: [
      {
        role: {
          id: 'role-1',
          code: 'admin',
          name: 'Admin',
          permissions: [{ id: 'p1', resource: 'users', action: 'read' }],
        },
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('AuthService', () => {
  let service: AuthService;
  let mockPrisma: MockPrismaService;
  let mockJwtService: {
    signAsync: ReturnType<typeof vi.fn>;
    verify: ReturnType<typeof vi.fn>;
  };
  let mockSessionsService: {
    createSession: ReturnType<typeof vi.fn>;
    findByRefreshToken: ReturnType<typeof vi.fn>;
    updateLastActiveTime: ReturnType<typeof vi.fn>;
    updateRefreshToken: ReturnType<typeof vi.fn>;
    deleteByRefreshToken: ReturnType<typeof vi.fn>;
    deleteCurrentSession: ReturnType<typeof vi.fn>;
    lockEmployeeForCredentials: ReturnType<typeof vi.fn>;
    lockSessionForRefresh: ReturnType<typeof vi.fn>;
    hashToken: ReturnType<typeof vi.fn>;
    revokeInteractiveCredentialsInTransaction: ReturnType<typeof vi.fn>;
    revokeAllCredentialsInTransaction: ReturnType<typeof vi.fn>;
    revokeAllCredentials: ReturnType<typeof vi.fn>;
  };
  let mockConfigService: {
    get: ReturnType<typeof vi.fn>;
    getOrThrow: ReturnType<typeof vi.fn>;
  };
  let mockDingtalkAuth: {
    getAccessToken: ReturnType<typeof vi.fn>;
    invalidate: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockPrisma = createMockPrismaService();

    mockJwtService = {
      signAsync: vi.fn(),
      verify: vi.fn(),
    };

    mockSessionsService = {
      createSession: vi.fn().mockResolvedValue(undefined),
      findByRefreshToken: vi.fn(),
      updateLastActiveTime: vi.fn().mockResolvedValue(undefined),
      updateRefreshToken: vi.fn().mockResolvedValue(undefined),
      deleteByRefreshToken: vi.fn().mockResolvedValue(undefined),
      deleteCurrentSession: vi.fn().mockResolvedValue({ success: true }),
      lockEmployeeForCredentials: vi
        .fn()
        .mockResolvedValue({ id: 'emp-1', tokenInvalidAfter: null }),
      lockSessionForRefresh: vi.fn().mockResolvedValue(true),
      hashToken: vi.fn((token: string) => `hash:${token}`),
      revokeInteractiveCredentialsInTransaction: vi.fn().mockResolvedValue({
        tokenInvalidAfter: new Date(),
        revokedSessions: 0,
      }),
      revokeAllCredentialsInTransaction: vi.fn().mockResolvedValue({
        tokenInvalidAfter: new Date(),
        revokedSessions: 0,
        revokedPats: 0,
      }),
      revokeAllCredentials: vi.fn().mockResolvedValue({
        revokedSessions: 0,
        revokedPats: 0,
      }),
    };

    mockConfigService = {
      get: vi.fn((key: string, defaultValue?: string) => {
        const map: Record<string, string> = {
          JWT_ACCESS_EXPIRES_IN: '2h',
          JWT_REFRESH_EXPIRES_IN: '7d',
          JWT_SECRET: 'test-secret',
          JWT_REFRESH_SECRET: 'test-refresh-secret',
        };
        return map[key] ?? defaultValue;
      }),
      getOrThrow: vi.fn((key: string) => {
        const map: Record<string, string> = {
          JWT_ACCESS_EXPIRES_IN: '2h',
          JWT_REFRESH_EXPIRES_IN: '7d',
          JWT_SECRET: 'test-secret',
          JWT_REFRESH_SECRET: 'test-refresh-secret',
        };
        const value = map[key];
        if (value === undefined) throw new Error(`${key} is required`);
        return value;
      }),
    };

    mockDingtalkAuth = {
      getAccessToken: vi.fn().mockResolvedValue('dingtalk-access-token'),
      invalidate: vi.fn(),
    };

    service = new AuthService(
      asPrismaService(mockPrisma),
      mockJwtService as unknown as JwtService,
      mockConfigService as unknown as ConfigService,
      new EmployeePermissionCacheService(),
      mockDingtalkAuth as unknown as DingtalkAuth,
      mockSessionsService as unknown as SessionsService
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('login', () => {
    const loginDto = { username: 'testuser', password: 'Test@123456', rememberMe: false };
    const ip = '127.0.0.1';
    const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';

    beforeEach(() => {
      // First call resolves the pre-lock candidate; second call revalidates global cross-column ownership.
      mockPrisma.employee.findMany.mockResolvedValue([{ id: 'emp-1' }]);
    });

    function setupSuccessfulLogin() {
      const mockEmp = buildMockEmployee();
      mockPrisma.employee.findFirst.mockResolvedValue(mockEmp);
      mockPrisma.employee.findUnique.mockResolvedValue(mockEmp);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
      mockJwtService.signAsync
        .mockResolvedValueOnce('access-token-123')
        .mockResolvedValueOnce('refresh-token-456');
      mockPrisma.employee.update.mockResolvedValue(mockEmp);
      mockPrisma.loginLog.create.mockResolvedValue({});
      return mockEmp;
    }

    it('成功登录返回 tokens 和用户信息', async () => {
      const mockEmp = setupSuccessfulLogin();

      const result = await service.login(loginDto, ip, userAgent);

      expect(result.accessToken).toBe('access-token-123');
      expect(result.refreshToken).toBe('refresh-token-456');
      expect(result.user.id).toBe(mockEmp.id);
      expect(result.user.username).toBe('testuser');
      expect(result.user.roles).toHaveLength(1);
      expect(result.user.roles[0]!.code).toBe('admin');
      expect(mockPrisma.$executeRaw.mock.calls[0]?.[1]).toBe('employee_login_identifier:testuser');
      expect(
        mockSessionsService.lockEmployeeForCredentials.mock.invocationCallOrder[0]
      ).toBeLessThan(
        mockPrisma.$executeRaw.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
      );
    });

    it('holds the Employee credential lock while signing and creates Session with the shared jti', async () => {
      setupSuccessfulLogin();

      await service.login(loginDto, ip, userAgent);

      expect(mockSessionsService.lockEmployeeForCredentials).toHaveBeenCalledOnce();
      const accessPayload = mockJwtService.signAsync.mock.calls[0]?.[0] as { jti: string };
      const refreshPayload = mockJwtService.signAsync.mock.calls[1]?.[0] as { jti: string };
      const sessionId = mockSessionsService.createSession.mock.calls[0]?.[1];
      expect(accessPayload.jti).toBe(sessionId);
      expect(refreshPayload.jti).toBe(sessionId);
      expect(
        mockSessionsService.lockEmployeeForCredentials.mock.invocationCallOrder[0]
      ).toBeLessThan(
        mockJwtService.signAsync.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
      );
    });

    it('persists initial authenticatedAt and signs both tokens with auth_time so fresh auth passes', async () => {
      setupSuccessfulLogin();

      await service.login(loginDto, ip, userAgent);

      const sessionInput = mockSessionsService.createSession.mock.calls[0]?.[0] as {
        loginTime: Date;
      };
      const expectedAuthTime = Math.floor(sessionInput.loginTime.getTime() / 1000);
      expect(mockJwtService.signAsync).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ auth_time: expectedAuthTime, tokenType: 'access' }),
        expect.anything()
      );
      expect(mockJwtService.signAsync).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ auth_time: expectedAuthTime, tokenType: 'refresh' }),
        expect.anything()
      );
      expect(() =>
        assertFreshJwtAuthentication(
          { authType: 'jwt', authenticatedAt: new Date(expectedAuthTime * 1000) },
          new Date()
        )
      ).not.toThrow();
    });

    it('用户不存在时抛出 UnauthorizedException', async () => {
      mockPrisma.employee.findMany.mockResolvedValue([]);
      mockPrisma.loginLog.create.mockResolvedValue({});

      await expect(service.login(loginDto, ip, userAgent)).rejects.toThrow(UnauthorizedException);
    });

    it('A.username 与 B.phone 同值时 findMany take 2 并 fail closed 记录失败日志', async () => {
      mockPrisma.employee.findMany.mockResolvedValueOnce([{ id: 'emp-a' }, { id: 'emp-b' }]);
      mockPrisma.loginLog.create.mockResolvedValue({});

      await expect(service.login(loginDto, ip, userAgent)).rejects.toThrow(UnauthorizedException);

      expect(mockPrisma.employee.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ username: 'testuser' }, { phone: 'testuser' }],
          deletedAt: null,
        },
        select: { id: true },
        take: 2,
      });
      expect(mockSessionsService.lockEmployeeForCredentials).not.toHaveBeenCalled();
      expect(mockPrisma.loginLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          employeeId: null,
          status: 'fail',
          failReason: '登录标识匹配多个员工',
        }),
      });
    });

    it('候选行锁后 username/phone 已改名时不校验密码也不锁错主体', async () => {
      const renamed = buildMockEmployee({ username: 'renamed', phone: null });
      mockPrisma.employee.findUnique.mockResolvedValue(renamed);
      mockPrisma.loginLog.create.mockResolvedValue({});

      await expect(service.login(loginDto, ip, userAgent)).rejects.toThrow(UnauthorizedException);

      expect(bcrypt.compare).not.toHaveBeenCalled();
      expect(mockPrisma.employee.update).not.toHaveBeenCalled();
      expect(mockPrisma.loginLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          employeeId: null,
          failReason: '登录标识已变更或匹配多个员工',
        }),
      });
    });

    it('行锁后重验发现 2 个跨列 owner 时 fail closed', async () => {
      const employee = buildMockEmployee();
      mockPrisma.employee.findUnique.mockResolvedValue(employee);
      mockPrisma.employee.findMany
        .mockResolvedValueOnce([{ id: employee.id }])
        .mockResolvedValueOnce([{ id: employee.id }, { id: 'emp-b' }]);
      mockPrisma.loginLog.create.mockResolvedValue({});

      await expect(service.login(loginDto, ip, userAgent)).rejects.toThrow(UnauthorizedException);

      expect(bcrypt.compare).not.toHaveBeenCalled();
      expect(mockPrisma.loginLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ employeeId: null, status: 'fail' }),
      });
    });

    it('密码错误在 Employee 行锁事务提交后才抛 UnauthorizedException', async () => {
      const employee = buildMockEmployee();
      mockPrisma.employee.findFirst.mockResolvedValue(employee);
      mockPrisma.employee.findUnique.mockResolvedValue(employee);
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
      mockPrisma.employee.update.mockResolvedValue({ loginFailCount: 1 });
      mockPrisma.loginLog.create.mockResolvedValue({});
      let committed = false;
      mockPrisma.$transaction.mockImplementationOnce(async (callback) => {
        const result = await callback(mockPrisma);
        committed = true;
        return result;
      });

      await expect(service.login(loginDto, ip, userAgent)).rejects.toSatisfy((error: unknown) => {
        expect(committed).toBe(true);
        expect(error).toBeInstanceOf(UnauthorizedException);
        return true;
      });
      expect(mockSessionsService.lockEmployeeForCredentials).toHaveBeenCalledOnce();
      expect(mockPrisma.loginLog.create).toHaveBeenCalledOnce();
      expect(mockSessionsService.revokeAllCredentialsInTransaction).not.toHaveBeenCalled();
    });

    it('第 4 次密码错误不会锁定账号或撤销凭据', async () => {
      const employee = buildMockEmployee({ loginFailCount: 3 });
      mockPrisma.employee.findFirst.mockResolvedValue(employee);
      mockPrisma.employee.findUnique.mockResolvedValue(employee);
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
      mockPrisma.employee.update.mockResolvedValue({ loginFailCount: 4 });
      mockPrisma.loginLog.create.mockResolvedValue({});

      await expect(service.login(loginDto, ip, userAgent)).rejects.toThrow('用户名或密码错误');

      expect(mockPrisma.employee.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.employee.update).toHaveBeenCalledWith({
        where: { id: 'emp-1' },
        data: { loginFailCount: { increment: 1 } },
        select: { loginFailCount: true },
      });
      expect(mockSessionsService.revokeInteractiveCredentialsInTransaction).not.toHaveBeenCalled();
      expect(mockSessionsService.revokeAllCredentialsInTransaction).not.toHaveBeenCalled();
      expect(mockPrisma.loginLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'fail',
          failReason: '密码错误(第4次)',
        }),
      });
    });

    it('第 5 次密码错误在同一事务锁定并仅撤销交互式凭据，且最后写失败日志', async () => {
      const employee = buildMockEmployee({ loginFailCount: 4 });
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      mockPrisma.employee.findFirst.mockResolvedValue(employee);
      mockPrisma.employee.findUnique.mockResolvedValue(employee);
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
      mockPrisma.employee.update
        .mockResolvedValueOnce({ loginFailCount: 5 })
        .mockResolvedValueOnce({});
      mockPrisma.loginLog.create.mockResolvedValue({});
      mockSessionsService.revokeInteractiveCredentialsInTransaction.mockResolvedValue({
        tokenInvalidAfter: new Date(),
        revokedSessions: 2,
      });

      await expect(service.login(loginDto, ip, userAgent)).rejects.toThrow('用户名或密码错误');

      expect(mockPrisma.employee.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'emp-1' },
        data: { loginFailCount: { increment: 1 } },
        select: { loginFailCount: true },
      });
      expect(mockPrisma.employee.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'emp-1' },
        data: { lockUntil: expect.any(Date), loginStatus: 'locked' },
      });
      expect(mockSessionsService.revokeInteractiveCredentialsInTransaction).toHaveBeenCalledWith(
        mockPrisma,
        'emp-1',
        null
      );
      expect(mockSessionsService.revokeAllCredentialsInTransaction).not.toHaveBeenCalled();
      expect(
        mockSessionsService.revokeInteractiveCredentialsInTransaction.mock.invocationCallOrder[0]
      ).toBeLessThan(mockPrisma.loginLog.create.mock.invocationCallOrder[0] ?? 0);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('撤销 2 个交互式会话'));
      expect(warn.mock.calls.flat().join('')).not.toContain('PAT');
    });

    it('交互式凭据撤销失败时事务拒绝且不写成功后的失败日志', async () => {
      const employee = buildMockEmployee({ loginFailCount: 4 });
      mockPrisma.employee.findFirst.mockResolvedValue(employee);
      mockPrisma.employee.findUnique.mockResolvedValue(employee);
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
      mockPrisma.employee.update
        .mockResolvedValueOnce({ loginFailCount: 5 })
        .mockResolvedValueOnce({});
      mockSessionsService.revokeInteractiveCredentialsInTransaction.mockRejectedValue(
        new Error('session revoke failed')
      );

      await expect(service.login(loginDto, ip, userAgent)).rejects.toThrow('session revoke failed');

      expect(mockSessionsService.revokeInteractiveCredentialsInTransaction).toHaveBeenCalledOnce();
      expect(mockSessionsService.revokeAllCredentialsInTransaction).not.toHaveBeenCalled();
      expect(mockPrisma.loginLog.create).not.toHaveBeenCalled();
    });

    it('失败日志写入失败时整个密码失败事务拒绝而不转换为 401', async () => {
      const employee = buildMockEmployee();
      mockPrisma.employee.findFirst.mockResolvedValue(employee);
      mockPrisma.employee.findUnique.mockResolvedValue(employee);
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
      mockPrisma.employee.update.mockResolvedValue({ loginFailCount: 1 });
      mockPrisma.loginLog.create.mockRejectedValue(new Error('login log failed'));

      await expect(service.login(loginDto, ip, userAgent)).rejects.toThrow('login log failed');
      expect(mockSessionsService.revokeAllCredentialsInTransaction).not.toHaveBeenCalled();
    });

    it('账号状态为 disabled 时抛出 UnauthorizedException', async () => {
      const employee = buildMockEmployee({ loginStatus: 'disabled' });
      mockPrisma.employee.findFirst.mockResolvedValue(employee);
      mockPrisma.employee.findUnique.mockResolvedValue(employee);
      mockPrisma.loginLog.create.mockResolvedValue({});

      await expect(service.login(loginDto, ip, userAgent)).rejects.toThrow('账号已被禁用');
    });

    it('账号状态为 locked 时抛出 UnauthorizedException', async () => {
      const employee = buildMockEmployee({
        loginStatus: 'locked',
        lockUntil: new Date(Date.now() + 30 * 60 * 1000),
        loginFailCount: 5,
      });
      mockPrisma.employee.findFirst.mockResolvedValue(employee);
      mockPrisma.employee.findUnique.mockResolvedValue(employee);
      mockPrisma.loginLog.create.mockResolvedValue({});

      await expect(service.login(loginDto, ip, userAgent)).rejects.toThrow(/账号已被锁定/);
    });

    it('rememberMe=true 时使用 7d/30d 过期时间', async () => {
      setupSuccessfulLogin();

      await service.login({ ...loginDto, rememberMe: true }, ip, userAgent);

      expect(mockJwtService.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ tokenType: 'access' }),
        expect.objectContaining({ expiresIn: '7d' })
      );
      expect(mockJwtService.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ tokenType: 'refresh' }),
        expect.objectContaining({ expiresIn: '30d' })
      );
    });

    it('rememberMe=false 时使用配置默认过期时间', async () => {
      setupSuccessfulLogin();

      await service.login({ ...loginDto, rememberMe: false }, ip, userAgent);

      expect(mockJwtService.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ tokenType: 'access' }),
        expect.objectContaining({ expiresIn: '2h' })
      );
    });

    it('登录成功后创建 session', async () => {
      setupSuccessfulLogin();

      await service.login(loginDto, ip, userAgent);

      expect(mockSessionsService.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeId: 'emp-1',
          refreshToken: 'refresh-token-456',
          ipAddress: ip,
        }),
        expect.any(String),
        expect.anything()
      );
    });

    it('登录成功后更新 lastLoginAt', async () => {
      setupSuccessfulLogin();

      await service.login(loginDto, ip, userAgent);

      expect(mockPrisma.employee.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'emp-1' },
          data: expect.objectContaining({
            lastLoginAt: expect.any(Date),
            lastLoginIp: ip,
          }),
        })
      );
    });

    it('登录成功后记录登录日志', async () => {
      setupSuccessfulLogin();

      await service.login(loginDto, ip, userAgent);

      expect(mockPrisma.loginLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          username: 'testuser',
          actionType: 'login',
          ip,
          userAgent,
          status: 'success',
        }),
      });
    });

    it('未提供 ip 和 userAgent 时使用默认值', async () => {
      setupSuccessfulLogin();

      await service.login(loginDto);

      expect(mockSessionsService.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          ipAddress: 'unknown',
        }),
        expect.any(String),
        expect.anything()
      );
    });
  });

  describe('dingtalkLogin', () => {
    const pair = { userId: 'ding-user-1', unionId: 'ding-union-1' };

    function mockInAppIdentity(identity: { userId?: string; unionId?: string }) {
      const dingtalkOapi = (
        service as unknown as {
          dingtalkOapi: { post: ReturnType<typeof vi.fn> };
        }
      ).dingtalkOapi;
      vi.spyOn(dingtalkOapi, 'post').mockResolvedValue({
        errcode: 0,
        result: {
          userid: identity.userId,
          unionid: identity.unionId,
        },
      });
    }

    function setupSuccessfulDingtalkLogin() {
      const employee = buildMockEmployee({
        dingtalkUserId: pair.userId,
        dingtalkUnionId: pair.unionId,
        dingtalkActive: true,
      });
      mockInAppIdentity(pair);
      mockPrisma.employee.findMany
        .mockResolvedValueOnce([employee])
        .mockResolvedValueOnce([employee]);
      mockPrisma.employee.findUnique.mockResolvedValue(employee);
      mockJwtService.signAsync
        .mockResolvedValueOnce('access-token')
        .mockResolvedValueOnce('refresh-token');
      mockPrisma.employee.update.mockResolvedValue(employee);
      mockPrisma.loginLog.create.mockResolvedValue({});
      return employee;
    }

    it('rejects web OAuth data that only has mobile/unionId and never uses mobile fallback', async () => {
      mockConfigService.get.mockImplementation((key: string, defaultValue?: string) => {
        const map: Record<string, string> = {
          DINGTALK_WEB_CLIENT_ID: 'ding-web-client-id',
          DINGTALK_WEB_CLIENT_SECRET: 'ding-web-client-secret',
          JWT_ACCESS_EXPIRES_IN: '2h',
          JWT_REFRESH_EXPIRES_IN: '7d',
        };
        return map[key] ?? defaultValue;
      });
      vi.spyOn(axios, 'post').mockResolvedValue({ data: { accessToken: 'oauth-token' } });
      vi.spyOn(axios, 'get').mockResolvedValue({
        data: { unionId: pair.unionId, mobile: '13800138000' },
      });

      await expect(
        service.dingtalkLogin({ code: 'auth-code', source: 'web' }, '127.0.0.1', 'vitest')
      ).rejects.toThrow('未返回完整用户身份 pair');
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.employee.findMany).not.toHaveBeenCalled();
    });

    it.each([
      { userId: pair.userId },
      { unionId: pair.unionId },
      { userId: '   ', unionId: pair.unionId },
    ])('rejects an incomplete identity pair %# before employee lookup', async (identity) => {
      mockInAppIdentity(identity);

      await expect(service.dingtalkLogin({ code: 'auth-code', source: 'in_app' })).rejects.toThrow(
        '未返回完整用户身份 pair'
      );
      expect(mockPrisma.employee.findMany).not.toHaveBeenCalled();
    });

    it('rejects when userId and unionId resolve to two different employees', async () => {
      const userEmployee = buildMockEmployee({
        id: 'emp-user',
        dingtalkUserId: pair.userId,
        dingtalkUnionId: 'other-union',
      });
      const unionEmployee = buildMockEmployee({
        id: 'emp-union',
        dingtalkUserId: 'other-user',
        dingtalkUnionId: pair.unionId,
      });
      mockInAppIdentity(pair);
      mockPrisma.employee.findMany
        .mockResolvedValueOnce([userEmployee])
        .mockResolvedValueOnce([unionEmployee]);
      mockPrisma.loginLog.create.mockResolvedValue({});

      await expect(service.dingtalkLogin({ code: 'auth-code', source: 'in_app' })).rejects.toThrow(
        '未唯一绑定同一员工'
      );
      expect(mockSessionsService.createSession).not.toHaveBeenCalled();
    });

    it('rejects an unbound/inactive employee and cannot repopulate the cleared pair', async () => {
      mockInAppIdentity(pair);
      mockPrisma.employee.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      mockPrisma.loginLog.create.mockResolvedValue({});

      await expect(service.dingtalkLogin({ code: 'auth-code', source: 'in_app' })).rejects.toThrow(
        '未唯一绑定同一员工'
      );
      expect(mockPrisma.employee.findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { dingtalkUserId: pair.userId },
          take: 2,
        })
      );
      expect(mockPrisma.employee.findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: { dingtalkUnionId: pair.unionId },
          take: 2,
        })
      );
      expect(mockPrisma.employee.update).not.toHaveBeenCalled();
    });

    it('commits a locked SSO failure log before returning 401', async () => {
      const employee = buildMockEmployee({
        dingtalkUserId: pair.userId,
        dingtalkUnionId: pair.unionId,
        dingtalkActive: true,
        canLogin: false,
      });
      mockInAppIdentity(pair);
      mockPrisma.employee.findMany
        .mockResolvedValueOnce([employee])
        .mockResolvedValueOnce([employee]);
      mockPrisma.employee.findUnique.mockResolvedValue(employee);
      mockPrisma.loginLog.create.mockResolvedValue({});
      let transactionCommitted = false;
      mockPrisma.$transaction.mockImplementationOnce(async (callback) => {
        if (typeof callback !== 'function') return Promise.all(callback);
        const result = await callback(mockPrisma);
        transactionCommitted = true;
        return result;
      });

      await expect(service.dingtalkLogin({ code: 'auth-code', source: 'in_app' })).rejects.toThrow(
        '账号未开通登录权限'
      );

      expect(transactionCommitted).toBe(true);
      expect(mockPrisma.loginLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          employeeId: employee.id,
          status: 'fail',
          failReason: '账号未开通登录权限',
        }),
      });
      expect(mockSessionsService.createSession).not.toHaveBeenCalled();
    });

    it('requires each identity key to resolve uniquely even before the DB union unique is applied', async () => {
      const employee = buildMockEmployee({
        dingtalkUserId: pair.userId,
        dingtalkUnionId: pair.unionId,
      });
      mockInAppIdentity(pair);
      mockPrisma.employee.findMany
        .mockResolvedValueOnce([employee])
        .mockResolvedValueOnce([employee, buildMockEmployee({ id: 'emp-duplicate' })]);
      mockPrisma.loginLog.create.mockResolvedValue({});

      await expect(service.dingtalkLogin({ code: 'auth-code', source: 'in_app' })).rejects.toThrow(
        '未唯一绑定同一员工'
      );
    });

    it('fails closed when an active and soft-deleted Employee share either identity key', async () => {
      const active = buildMockEmployee({
        dingtalkUserId: pair.userId,
        dingtalkUnionId: pair.unionId,
      });
      const softDeleted = buildMockEmployee({
        id: 'emp-soft-deleted',
        deletedAt: new Date(),
        dingtalkUserId: pair.userId,
        dingtalkUnionId: 'old-union',
        dingtalkActive: false,
      });
      mockInAppIdentity(pair);
      mockPrisma.employee.findMany
        .mockResolvedValueOnce([active, softDeleted])
        .mockResolvedValueOnce([active]);
      mockPrisma.loginLog.create.mockResolvedValue({});

      await expect(service.dingtalkLogin({ code: 'auth-code', source: 'in_app' })).rejects.toThrow(
        '未唯一绑定同一员工'
      );
      expect(mockSessionsService.lockEmployeeForCredentials).not.toHaveBeenCalled();
      expect(mockSessionsService.createSession).not.toHaveBeenCalled();
    });

    it('locks the proof pair in the same sorted key contract as bind before both lookups', async () => {
      setupSuccessfulDingtalkLogin();

      await service.dingtalkLogin({ code: 'auth-code', source: 'in_app' });

      const lockKeys = mockPrisma.$executeRaw.mock.calls.map((call) => call[1]);
      expect(lockKeys).toEqual([
        'employee_dingtalk:union:ding-union-1',
        'employee_dingtalk:user:ding-user-1',
      ]);
      expect(mockPrisma.$executeRaw.mock.invocationCallOrder.at(-1)).toBeLessThan(
        mockPrisma.employee.findMany.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
      );
    });

    it('logs in only on an exact pair match and never writes identity fields', async () => {
      setupSuccessfulDingtalkLogin();

      const result = await service.dingtalkLogin({ code: 'auth-code', source: 'in_app' });

      expect(result.accessToken).toBe('access-token');
      expect(mockSessionsService.createSession).toHaveBeenCalledOnce();
      expect(mockPrisma.employee.update).toHaveBeenCalledOnce();
      expect(mockPrisma.employee.update).toHaveBeenCalledWith({
        where: { id: 'emp-1' },
        data: {
          lastLoginAt: expect.any(Date),
          lastLoginIp: 'unknown',
        },
      });
      expect(mockPrisma.employee.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dingtalkUserId: expect.anything(),
          }),
        })
      );
    });

    it('web login configured with a Web clientId requires the corresponding Web secret', async () => {
      mockConfigService.get.mockImplementation((key: string, defaultValue?: string) => {
        const map: Record<string, string> = {
          DINGTALK_WEB_CLIENT_ID: 'ding-web-client-id',
          DINGTALK_CLIENT_SECRET: 'internal-app-secret',
          JWT_ACCESS_EXPIRES_IN: '2h',
          JWT_REFRESH_EXPIRES_IN: '7d',
        };
        return map[key] ?? defaultValue;
      });

      await expect(
        service.dingtalkLogin({ code: 'auth-code', source: 'web' }, '127.0.0.1', 'vitest')
      ).rejects.toThrow('钉钉登录配置缺失');
      expect(mockPrisma.employee.findMany).not.toHaveBeenCalled();
    });
  });

  describe('reauthenticate', () => {
    const session = {
      id: 'session-1',
      employeeId: 'emp-1',
      expiresAt: new Date(Date.now() + 60_000),
    };

    beforeEach(() => {
      mockPrisma.employee.findUnique.mockResolvedValue(buildMockEmployee());
      mockPrisma.employee.update.mockResolvedValue({ loginFailCount: 1 });
      mockPrisma.session.findUnique.mockResolvedValue(session);
      mockPrisma.session.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.loginLog.create.mockResolvedValue({});
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
      mockJwtService.signAsync
        .mockResolvedValueOnce('fresh-access-token')
        .mockResolvedValueOnce('fresh-refresh-token');
    });

    it('验证当前密码后更新 Session.loginTime 并轮换当前会话凭据', async () => {
      const result = await service.reauthenticate('emp-1', 'session-1', 'Test@123456');

      expect(result.accessToken).toBe('fresh-access-token');
      expect(result.refreshToken).toBe('fresh-refresh-token');
      expect(mockSessionsService.lockEmployeeForCredentials).toHaveBeenCalledWith(
        expect.anything(),
        'emp-1'
      );
      expect(mockSessionsService.lockSessionForRefresh).toHaveBeenCalledWith(
        expect.anything(),
        'session-1'
      );
      expect(mockPrisma.session.updateMany).toHaveBeenCalledWith({
        where: { id: 'session-1', employeeId: 'emp-1' },
        data: expect.objectContaining({
          refreshToken: 'hash:fresh-refresh-token',
          loginTime: expect.any(Date),
          lastActiveTime: expect.any(Date),
        }),
      });
      const accessPayload = mockJwtService.signAsync.mock.calls[0]?.[0] as {
        auth_time: number;
      };
      const loginTime = mockPrisma.session.updateMany.mock.calls[0]?.[0].data.loginTime as Date;
      expect(accessPayload.auth_time).toBe(Math.floor(loginTime.getTime() / 1000));
    });

    it('密码错误时不签发新凭据', async () => {
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

      await expect(service.reauthenticate('emp-1', 'session-1', 'wrong-password')).rejects.toThrow(
        ForbiddenException
      );

      expect(mockJwtService.signAsync).not.toHaveBeenCalled();
      expect(mockPrisma.session.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.employee.update).toHaveBeenCalledWith({
        where: { id: 'emp-1' },
        data: { loginFailCount: { increment: 1 } },
        select: { loginFailCount: true },
      });
      expect(mockPrisma.loginLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ actionType: 'reauth', status: 'fail' }),
      });
    });

    it('第 5 次密码错误会锁定账号并仅撤销交互式凭据', async () => {
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
      mockPrisma.employee.update.mockResolvedValueOnce({ loginFailCount: 5 });

      await expect(
        service.reauthenticate('emp-1', 'session-1', 'wrong-password', '127.0.0.1', 'test-agent')
      ).rejects.toThrow(ForbiddenException);

      expect(mockPrisma.employee.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'emp-1' },
        data: { loginStatus: 'locked', lockUntil: expect.any(Date) },
      });
      expect(mockSessionsService.revokeInteractiveCredentialsInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        'emp-1',
        null
      );
      expect(mockSessionsService.revokeAllCredentialsInTransaction).not.toHaveBeenCalled();
      expect(mockPrisma.loginLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actionType: 'reauth',
          status: 'fail',
          failReason: expect.stringContaining('账号已锁定'),
        }),
      });
    });

    it('缺少 JWT sessionId 时拒绝重新认证', async () => {
      await expect(service.reauthenticate('emp-1', undefined, 'Test@123456')).rejects.toThrow(
        UnauthorizedException
      );
      expect(mockSessionsService.lockEmployeeForCredentials).not.toHaveBeenCalled();
    });
  });

  describe('refreshToken', () => {
    const oldToken = 'valid-refresh-token';
    const session = {
      id: 'session-1',
      employeeId: 'emp-1',
      refreshToken: 'hash:valid-refresh-token',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      loginTime: new Date(Date.now() - 60_000),
    };

    function setupSuccessfulRefresh() {
      const issuedAt = Math.floor(Date.now() / 1000) - 1;
      mockJwtService.verify.mockReturnValue({
        sub: 'emp-1',
        eid: 'emp-1',
        tokenType: 'refresh',
        jti: 'session-1',
        iat: issuedAt,
        auth_time: issuedAt - 60,
      });
      mockPrisma.employee.findUnique.mockResolvedValue(buildMockEmployee());
      mockPrisma.session.findUnique.mockResolvedValue(session);
      mockPrisma.session.updateMany.mockResolvedValue({ count: 1 });
      mockJwtService.signAsync
        .mockResolvedValueOnce('new-access-token')
        .mockResolvedValueOnce('new-refresh-token');
      return issuedAt;
    }

    it('rotates refresh with the same jti and a refresh-hash CAS', async () => {
      setupSuccessfulRefresh();
      const result = await service.refreshToken(oldToken);

      expect(result).toEqual(
        expect.objectContaining({
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
          expiresIn: 7200,
          user: expect.objectContaining({ id: 'emp-1' }),
        })
      );
      expect(mockJwtService.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ jti: 'session-1', tokenType: 'access' }),
        expect.anything()
      );
      expect(mockPrisma.session.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'session-1',
            employeeId: 'emp-1',
            refreshToken: 'hash:valid-refresh-token',
          }),
        })
      );
    });

    it('refresh 响应重算完整 user 声明', async () => {
      setupSuccessfulRefresh();
      const employee = buildMockEmployee({
        userRoles: [
          {
            role: {
              id: 'role-1',
              code: 'ADMIN',
              name: '管理员',
              permissions: [
                {
                  module: 'system',
                  menu: 'users',
                  view: true,
                  create: false,
                  edit: true,
                  delete: false,
                  export: false,
                  approve: false,
                  viewScope: 'ALL',
                },
              ],
            },
          },
        ],
      });
      mockPrisma.employee.findUnique.mockResolvedValue(employee);

      await expect(service.getMe('emp-1')).resolves.toEqual(
        expect.objectContaining({ id: 'emp-1', status: 'active' })
      );

      const result = await service.refreshToken(oldToken);

      expect(result.user).toEqual({
        id: 'emp-1',
        username: 'testuser',
        phone: null,
        email: null,
        avatar: null,
        status: 'active',
        roles: [
          {
            id: 'role-1',
            code: 'ADMIN',
            name: '管理员',
            permissions: [
              {
                module: 'system',
                menu: 'users',
                view: true,
                create: false,
                edit: true,
                delete: false,
                export: false,
                approve: false,
                viewScope: 'ALL',
              },
            ],
          },
        ],
        employee: { id: 'emp-1', name: 'Test Employee' },
      });
    });

    it('rejects legacy refresh without jti/iat/auth_time', async () => {
      mockJwtService.verify.mockReturnValue({ sub: 'emp-1', tokenType: 'refresh' });
      await expect(service.refreshToken(oldToken)).rejects.toThrow(UnauthorizedException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it.each([
      ['wrong tokenType', { tokenType: 'access' }],
      ['missing sub', { sub: undefined }],
      ['blank eid', { eid: '   ' }],
      ['split identity', { eid: 'emp-other' }],
      ['blank jti', { jti: '' }],
      ['non-finite iat', { iat: Number.POSITIVE_INFINITY }],
      ['non-positive iat', { iat: 0 }],
      ['future iat', { iat: Math.floor(Date.now() / 1000) + 60 }],
      ['missing auth_time', { auth_time: undefined }],
      ['non-finite auth_time', { auth_time: Number.NaN }],
      ['non-positive auth_time', { auth_time: -1 }],
      ['future auth_time', { auth_time: Math.floor(Date.now() / 1000) + 31 }],
      [
        'auth_time later than iat',
        {
          iat: Math.floor(Date.now() / 1000) - 2,
          auth_time: Math.floor(Date.now() / 1000) - 1,
        },
      ],
    ])('rejects invalid refresh claims: %s', async (_label, overrides) => {
      const now = Math.floor(Date.now() / 1000);
      mockJwtService.verify.mockReturnValue({
        sub: 'emp-1',
        eid: 'emp-1',
        tokenType: 'refresh',
        jti: 'session-1',
        iat: now,
        auth_time: now,
        ...overrides,
      });

      await expect(service.refreshToken(oldToken)).rejects.toThrow(UnauthorizedException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('uses locked DB Session.loginTime as auth_time instead of the old token claim', async () => {
      setupSuccessfulRefresh();
      const authoritativeLoginTime = new Date(Date.now() - 10 * 60_000);
      mockPrisma.session.findUnique.mockResolvedValue({
        ...session,
        loginTime: authoritativeLoginTime,
      });

      await service.refreshToken(oldToken);

      const expectedAuthTime = Math.floor(authoritativeLoginTime.getTime() / 1000);
      expect(mockJwtService.signAsync).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ auth_time: expectedAuthTime, tokenType: 'access' }),
        expect.anything()
      );
      expect(mockJwtService.signAsync).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ auth_time: expectedAuthTime, tokenType: 'refresh' }),
        expect.anything()
      );
      expect(() =>
        assertFreshJwtAuthentication(
          { authType: 'jwt', authenticatedAt: new Date(expectedAuthTime * 1000) },
          new Date()
        )
      ).toThrow('认证时间无效或已超过 5 分钟');
    });

    it('rejects a deleted or mismatched Session', async () => {
      setupSuccessfulRefresh();
      mockPrisma.session.findUnique.mockResolvedValue(null);
      await expect(service.refreshToken(oldToken)).rejects.toThrow(UnauthorizedException);

      setupSuccessfulRefresh();
      mockPrisma.session.findUnique.mockResolvedValue({ ...session, employeeId: 'other' });
      await expect(service.refreshToken(oldToken)).rejects.toThrow(UnauthorizedException);
    });

    it('only one concurrent refresh generation can win the old-hash CAS', async () => {
      setupSuccessfulRefresh();
      mockPrisma.session.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });
      mockJwtService.signAsync
        .mockResolvedValueOnce('access-a')
        .mockResolvedValueOnce('refresh-a')
        .mockResolvedValueOnce('access-b')
        .mockResolvedValueOnce('refresh-b');

      await expect(service.refreshToken(oldToken)).resolves.toBeDefined();
      await expect(service.refreshToken(oldToken)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects refresh at the exact tokenInvalidAfter second', async () => {
      const issuedAt = setupSuccessfulRefresh();
      mockPrisma.employee.findUnique.mockResolvedValue(
        buildMockEmployee({ tokenInvalidAfter: new Date(issuedAt * 1000) })
      );
      await expect(service.refreshToken(oldToken)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    const employeeId = 'emp-1';
    const ip = '192.168.1.1';
    const refreshToken = 'refresh-token-to-delete';

    beforeEach(() => {
      mockPrisma.employee.findUnique.mockResolvedValue(buildMockEmployee({ id: employeeId }));
      mockPrisma.loginLog.create.mockResolvedValue({});
    });

    it('有 refreshToken 时删除 session 并记录日志', async () => {
      const result = await service.logout(employeeId, ip, refreshToken);

      expect(mockSessionsService.deleteByRefreshToken).toHaveBeenCalledWith(refreshToken);
      expect(mockPrisma.loginLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          username: 'testuser',
          actionType: 'logout',
          ip,
          status: 'success',
        }),
      });
      expect(result).toEqual({ message: '登出成功' });
    });

    it('优先按 access token jti 删除当前 Session', async () => {
      await service.logout(employeeId, ip, refreshToken, 'session-current');

      expect(mockSessionsService.deleteCurrentSession).toHaveBeenCalledWith(
        employeeId,
        'session-current'
      );
      expect(mockSessionsService.deleteByRefreshToken).not.toHaveBeenCalled();
    });

    it('无 refreshToken 时不调用 deleteByRefreshToken', async () => {
      await service.logout(employeeId, ip);

      expect(mockSessionsService.deleteByRefreshToken).not.toHaveBeenCalled();
      expect(mockPrisma.loginLog.create).toHaveBeenCalled();
    });

    it('员工不存在时使用 unknown 作为 username', async () => {
      mockPrisma.employee.findUnique.mockResolvedValue(null);

      await service.logout('nonexistent-emp', ip, refreshToken);

      expect(mockPrisma.loginLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ username: 'unknown' }),
      });
    });

    it('未提供 ip 时使用 unknown', async () => {
      await service.logout(employeeId);

      expect(mockPrisma.loginLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ ip: 'unknown' }),
      });
    });
  });

  describe('generateTokens', () => {
    it('生成的 payload 包含正确的 tokenType', async () => {
      mockJwtService.signAsync
        .mockResolvedValueOnce('access-tok')
        .mockResolvedValueOnce('refresh-tok');

      // @ts-expect-error: 访问私有方法用于测试
      await service.generateTokens('emp-1', 'testuser', ['admin'], 'session-1', null, new Date());

      expect(mockJwtService.signAsync).toHaveBeenCalledTimes(2);
      expect(mockJwtService.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'emp-1',
          eid: 'emp-1',
          username: 'testuser',
          roles: ['admin'],
          jti: 'session-1',
          iat: expect.any(Number),
          auth_time: expect.any(Number),
          tokenType: 'access',
        }),
        expect.objectContaining({ expiresIn: '2h' })
      );
    });

    it('传入自定义过期时间时覆盖默认值', async () => {
      mockJwtService.signAsync
        .mockResolvedValueOnce('access-tok')
        .mockResolvedValueOnce('refresh-tok');

      // @ts-expect-error: 访问私有方法用于测试
      await service.generateTokens(
        'emp-1',
        'testuser',
        ['admin'],
        'session-1',
        null,
        new Date(),
        '1h',
        '14d'
      );

      expect(mockJwtService.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ tokenType: 'access' }),
        expect.objectContaining({ expiresIn: '1h' })
      );
    });
  });

  describe('parseExpiresIn', () => {
    it.each([
      ['30s', 30],
      ['5m', 300],
      ['2h', 7200],
      ['7d', 604800],
      ['invalid', 900],
    ])('parseExpiresIn("%s") 返回 %d 秒', (input, expected) => {
      // @ts-expect-error: 访问私有方法用于测试
      expect(service.parseExpiresIn(input)).toBe(expected);
    });
  });
});
