import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/prisma-mock.factory';
import { SessionsService } from '../sessions.service';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function buildSession(overrides: Record<string, unknown> = {}) {
  // push 6: sessions 仅 employeeId 列
  return {
    id: 'sess-1',
    employeeId: 'user-1',
    deviceType: 'desktop',
    deviceName: 'macOS',
    browser: 'Chrome 120',
    os: 'macOS 14',
    ipAddress: '127.0.0.1',
    location: null,
    refreshToken: hashToken('token-1'),
    loginTime: new Date(),
    lastActiveTime: new Date(),
    expiresAt: new Date(Date.now() + 86400000),
    ...overrides,
  };
}

describe('SessionsService', () => {
  let service: SessionsService;
  let mockPrisma: MockPrismaService;

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    service = new SessionsService(asPrismaService(mockPrisma));
  });

  // ─── findAllByUserId ────────────────────────────────────────────────

  describe('findAllByUserId', () => {
    it('返回会话列表', async () => {
      const sessions = [
        buildSession(),
        buildSession({ id: 'sess-2', refreshToken: hashToken('token-2') }),
      ];
      mockPrisma.session.findMany.mockResolvedValue(sessions);

      const result = await service.findAllByUserId('user-1');

      expect(mockPrisma.session.findMany).toHaveBeenCalledWith({
        where: { employeeId: 'user-1' },
        orderBy: { lastActiveTime: 'desc' },
      });
      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('id', 'sess-1');
      expect(result[0]).not.toHaveProperty('refreshToken');
    });

    it('标记 isCurrent', async () => {
      const sessions = [
        buildSession({ refreshToken: hashToken('current-token') }),
        buildSession({ id: 'sess-2', refreshToken: hashToken('other-token') }),
      ];
      mockPrisma.session.findMany.mockResolvedValue(sessions);

      const result = await service.findAllByUserId('user-1', 'current-token');

      expect(result[0]!.isCurrent).toBe(true);
      expect(result[1]!.isCurrent).toBe(false);
    });

    it('无 currentToken 时 isCurrent 全部为 false', async () => {
      const sessions = [buildSession()];
      mockPrisma.session.findMany.mockResolvedValue(sessions);

      const result = await service.findAllByUserId('user-1');

      expect(result[0]!.isCurrent).toBe(false);
    });
  });

  // ─── createSession ──────────────────────────────────────────────────

  describe('createSession', () => {
    it('使用预生成 id 创建会话，使 access/refresh 的 jti 与 Session.id 一致', async () => {
      const data = {
        employeeId: 'emp-1',
        deviceType: 'desktop',
        deviceName: 'macOS',
        browser: 'Chrome 120',
        os: 'macOS 14',
        ipAddress: '127.0.0.1',
        refreshToken: 'token-1',
        expiresAt: new Date(Date.now() + 86400000),
      };
      mockPrisma.session.create.mockResolvedValue(buildSession({ id: 'prebuilt-session' }));

      await service.createSession(data, 'prebuilt-session');

      expect(mockPrisma.session.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ id: 'prebuilt-session', employeeId: 'emp-1' }),
      });
    });

    it('显式持久化首次认证时间到 loginTime', async () => {
      const authenticatedAt = new Date('2026-08-24T17:55:00.000Z');
      const data = {
        employeeId: 'emp-1',
        deviceType: 'desktop',
        deviceName: 'macOS',
        browser: 'Chrome 120',
        os: 'macOS 14',
        ipAddress: '127.0.0.1',
        refreshToken: 'token-1',
        expiresAt: new Date(Date.now() + 86400000),
        loginTime: authenticatedAt,
      };
      mockPrisma.session.create.mockResolvedValue(buildSession({ loginTime: authenticatedAt }));

      await service.createSession(data);

      expect(mockPrisma.session.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ loginTime: authenticatedAt }),
      });
    });

    it('创建会话', async () => {
      const data = {
        employeeId: 'emp-1',
        deviceType: 'desktop',
        deviceName: 'macOS',
        browser: 'Chrome 120',
        os: 'macOS 14',
        ipAddress: '127.0.0.1',
        location: undefined,
        refreshToken: 'token-1',
        expiresAt: new Date(Date.now() + 86400000),
      };
      const created = buildSession();
      mockPrisma.session.create.mockResolvedValue(created);

      const result = await service.createSession(data);

      expect(mockPrisma.session.create).toHaveBeenCalledWith({
        data: {
          employeeId: 'emp-1',
          deviceType: data.deviceType,
          deviceName: data.deviceName,
          browser: data.browser,
          os: data.os,
          ipAddress: data.ipAddress,
          location: data.location,
          refreshToken: hashToken(data.refreshToken),
          expiresAt: data.expiresAt,
        },
      });
      expect(result).toEqual(created);
    });
  });

  // ─── deleteSession ──────────────────────────────────────────────────

  describe('deleteSession', () => {
    it('删除成功', async () => {
      const session = buildSession();
      mockPrisma.session.findUnique.mockResolvedValue(session);
      mockPrisma.session.delete.mockResolvedValue(session);

      const result = await service.deleteSession('sess-1', 'user-1', 'other-token');

      expect(mockPrisma.session.delete).toHaveBeenCalledWith({ where: { id: 'sess-1' } });
      expect(result).toEqual({ success: true });
    });

    it('不存在时抛出 NotFoundException', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(null);

      await expect(service.deleteSession('not-exist', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('非本人会话抛出 ForbiddenException', async () => {
      const session = buildSession({ employeeId: 'user-2' });
      mockPrisma.session.findUnique.mockResolvedValue(session);

      await expect(service.deleteSession('sess-1', 'user-1')).rejects.toThrow(ForbiddenException);
    });

    it('当前会话抛出 ForbiddenException', async () => {
      const session = buildSession({ refreshToken: hashToken('current-token') });
      mockPrisma.session.findUnique.mockResolvedValue(session);

      await expect(service.deleteSession('sess-1', 'user-1', 'current-token')).rejects.toThrow(
        ForbiddenException
      );
    });
  });

  // ─── deleteOtherSessions ───────────────────────────────────────────

  describe('deleteOtherSessions', () => {
    it('删除其他会话保留当前', async () => {
      mockPrisma.session.deleteMany.mockResolvedValue({ count: 3 });

      const result = await service.deleteOtherSessions('user-1', 'current-token');

      expect(mockPrisma.session.deleteMany).toHaveBeenCalledWith({
        where: {
          employeeId: 'user-1',
          refreshToken: { not: hashToken('current-token') },
        },
      });
      expect(result).toEqual({ deletedCount: 3 });
    });
  });

  // ─── updateLastActiveTime ──────────────────────────────────────────

  describe('updateLastActiveTime', () => {
    it('更新活跃时间', async () => {
      mockPrisma.session.update.mockResolvedValue(buildSession());

      await service.updateLastActiveTime('token-1');

      expect(mockPrisma.session.update).toHaveBeenCalledWith({
        where: { refreshToken: hashToken('token-1') },
        data: { lastActiveTime: expect.any(Date) },
      });
    });

    it('不存在时不抛错', async () => {
      mockPrisma.session.update.mockRejectedValue(new Error('Record not found'));

      await expect(service.updateLastActiveTime('non-exist')).resolves.toBeUndefined();
    });
  });

  // ─── findByRefreshToken ────────────────────────────────────────────

  describe('findByRefreshToken', () => {
    it('token 查找成功', async () => {
      const session = buildSession();
      mockPrisma.session.findUnique.mockResolvedValue(session);

      const result = await service.findByRefreshToken('token-1');

      expect(mockPrisma.session.findUnique).toHaveBeenCalledWith({
        where: { refreshToken: hashToken('token-1') },
      });
      expect(result).toEqual(session);
    });

    it('不存在时返回 null', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(null);

      const result = await service.findByRefreshToken('non-exist');

      expect(result).toBeNull();
    });
  });

  describe('deleteCurrentSession', () => {
    it('按 employeeId+jti 删除当前会话', async () => {
      mockPrisma.session.deleteMany.mockResolvedValue({ count: 1 });

      await expect(service.deleteCurrentSession('emp-1', 'sess-1')).resolves.toEqual({
        success: true,
      });
      expect(mockPrisma.session.deleteMany).toHaveBeenCalledWith({
        where: { id: 'sess-1', employeeId: 'emp-1' },
      });
    });
  });

  // ─── deleteByRefreshToken ──────────────────────────────────────────

  describe('deleteByRefreshToken', () => {
    it('token 删除成功', async () => {
      mockPrisma.session.delete.mockResolvedValue(buildSession());

      const result = await service.deleteByRefreshToken('token-1');

      expect(mockPrisma.session.delete).toHaveBeenCalledWith({
        where: { refreshToken: hashToken('token-1') },
      });
      expect(result).toEqual({ success: true });
    });

    it('错误时不抛出', async () => {
      mockPrisma.session.delete.mockRejectedValue(new Error('Record not found'));

      const result = await service.deleteByRefreshToken('non-exist');

      expect(result).toEqual({ success: true });
    });
  });

  // ─── cleanExpiredSessions ──────────────────────────────────────────

  describe('cleanExpiredSessions', () => {
    it('清理过期会话', async () => {
      mockPrisma.session.deleteMany.mockResolvedValue({ count: 5 });

      const result = await service.cleanExpiredSessions();

      expect(mockPrisma.session.deleteMany).toHaveBeenCalledWith({
        where: {
          expiresAt: { lt: expect.any(Date) },
        },
      });
      expect(result).toEqual({ deletedCount: 5 });
    });
  });

  describe('lockEmployeesForCredentials', () => {
    it('deduplicates and locks target plus actor Employee rows in sorted order', async () => {
      mockPrisma.$queryRaw.mockImplementation(async (...args: unknown[]) => {
        const employeeId = args[1] as string;
        return [{ id: employeeId, tokenInvalidAfter: null, deletedAt: null }];
      });

      const locked = await service.lockEmployeesForCredentials(
        asPrismaService(mockPrisma) as unknown as Prisma.TransactionClient,
        ['emp-z', 'emp-a', 'emp-z']
      );

      expect(mockPrisma.$queryRaw.mock.calls.map((call) => call[1])).toEqual(['emp-a', 'emp-z']);
      expect([...locked.keys()]).toEqual(['emp-a', 'emp-z']);
    });
  });

  describe('revokeInteractiveCredentialsInTransaction', () => {
    it('推进 JWT 失效边界并删除 Session，不更新 PAT', async () => {
      const previous = new Date(Date.now() + 10_000);
      mockPrisma.employee.update.mockResolvedValue({});
      mockPrisma.session.deleteMany.mockResolvedValue({ count: 2 });

      const result = await service.revokeInteractiveCredentialsInTransaction(
        asPrismaService(mockPrisma) as unknown as Prisma.TransactionClient,
        'emp-1',
        previous
      );

      expect(result.tokenInvalidAfter.getTime()).toBe(previous.getTime() + 1);
      expect(mockPrisma.employee.update).toHaveBeenCalledWith({
        where: { id: 'emp-1' },
        data: { tokenInvalidAfter: result.tokenInvalidAfter },
      });
      expect(mockPrisma.session.deleteMany).toHaveBeenCalledWith({
        where: { employeeId: 'emp-1' },
      });
      expect(mockPrisma.personalAccessToken.updateMany).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ revokedSessions: 2 }));
      expect(result).not.toHaveProperty('revokedPats');
    });
  });

  describe('revokeAllCredentials', () => {
    it('撤销失败时让 transaction 拒绝，使同事务 mutate 的锁定状态一并回滚', async () => {
      const mutate = vi.fn(async (tx: Prisma.TransactionClient) => {
        await tx.employee.updateMany({
          where: { id: 'emp-1' },
          data: { loginStatus: 'locked' },
        });
      });
      mockPrisma.$queryRaw.mockResolvedValue([{ id: 'emp-1', tokenInvalidAfter: null }]);
      mockPrisma.employee.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.employee.update.mockResolvedValue({});
      mockPrisma.session.deleteMany.mockResolvedValue({ count: 2 });
      mockPrisma.personalAccessToken.updateMany.mockRejectedValue(new Error('PAT revoke failed'));

      await expect(service.revokeAllCredentials('emp-1', mutate)).rejects.toThrow(
        'PAT revoke failed'
      );

      expect(mutate).toHaveBeenCalledOnce();
      expect(mockPrisma.employee.updateMany).toHaveBeenCalledWith({
        where: { id: 'emp-1' },
        data: { loginStatus: 'locked' },
      });
      expect(mockPrisma.$transaction).toHaveBeenCalledOnce();
    });

    it('在同一事务中单调推进边界并撤销全部 Session 与 active PAT', async () => {
      const previous = new Date(Date.now() + 10_000);
      mockPrisma.$queryRaw.mockResolvedValue([{ id: 'emp-1', tokenInvalidAfter: previous }]);
      mockPrisma.employee.update.mockResolvedValue({});
      mockPrisma.session.deleteMany.mockResolvedValue({ count: 2 });
      mockPrisma.personalAccessToken.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.revokeAllCredentials('emp-1');

      expect(result.tokenInvalidAfter.getTime()).toBe(previous.getTime() + 1);
      expect(mockPrisma.session.deleteMany).toHaveBeenCalledWith({
        where: { employeeId: 'emp-1' },
      });
      expect(mockPrisma.personalAccessToken.updateMany).toHaveBeenCalledWith({
        where: { employeeId: 'emp-1', revokedAt: null },
        data: { revokedAt: result.tokenInvalidAfter },
      });
      expect(result).toEqual(expect.objectContaining({ revokedSessions: 2, revokedPats: 3 }));
    });

    it('在 Employee 行锁前执行调用方声明的业务域前置锁', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ id: 'emp-1', tokenInvalidAfter: null }]);
      mockPrisma.employee.update.mockResolvedValue({});
      mockPrisma.session.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.personalAccessToken.updateMany.mockResolvedValue({ count: 0 });
      const beforeEmployeeLock = vi.fn(async (tx: Prisma.TransactionClient) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(1)`;
      });

      await service.revokeAllCredentials('emp-1', undefined, [], beforeEmployeeLock);

      expect(beforeEmployeeLock).toHaveBeenCalledOnce();
      expect(mockPrisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.$queryRaw.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
      );
    });
  });
});
