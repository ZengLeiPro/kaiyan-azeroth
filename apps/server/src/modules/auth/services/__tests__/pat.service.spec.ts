import { NotFoundException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../../test/prisma-mock.factory';
import { SessionsService } from '../../../sessions/sessions.service';
import { PatService } from '../pat.service';

/**
 * PatService 单测。覆盖:
 * - isPatToken: 前缀识别
 * - verify: token hash 查找、吊销、过期、未知 token
 * - issueByEmployeeId: 明文返回、prefix 生成、name 清洗、过期时间
 * - listByEmployee / listAll
 * - revoke: 幂等、不存在抛 NotFound
 *
 * 安全敏感(token 哈希、过期判定),所有关键路径都用结构断言。
 */
describe('PatService', () => {
  const protectedEmployeeId = '9f1f2538-86b0-4b69-901d-fb6cc9d38d9a';
  let service: PatService;
  let mockPrisma: MockPrismaService;

  beforeEach(() => {
    process.env.SUPER_ADMIN_EMPLOYEE_ID = protectedEmployeeId;
    mockPrisma = createMockPrismaService();
    const sessionsService = {
      lockEmployeeForCredentials: vi
        .fn()
        .mockResolvedValue({ id: 'emp-1', tokenInvalidAfter: null, deletedAt: null }),
      lockEmployeesForCredentials: vi.fn(
        async (_tx, employeeIds: readonly string[]) =>
          new Map(
            [...new Set(employeeIds)].map((employeeId) => [
              employeeId,
              { id: employeeId, tokenInvalidAfter: null, deletedAt: null },
            ])
          )
      ),
    } as unknown as SessionsService;
    service = new PatService(asPrismaService(mockPrisma), sessionsService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── isPatToken ─────────────────────────────────────────────────────────

  describe('isPatToken', () => {
    it('returns true for pat_ prefixed token', () => {
      expect(service.isPatToken('pat_someuser_abc123')).toBe(true);
    });

    it('returns false for non-pat token', () => {
      expect(service.isPatToken('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')).toBe(false);
      expect(service.isPatToken('Bearer xxx')).toBe(false);
      expect(service.isPatToken('')).toBe(false);
    });

    it('returns false for non-string input', () => {
      expect(service.isPatToken(123 as unknown as string)).toBe(false);
      expect(service.isPatToken(null as unknown as string)).toBe(false);
      expect(service.isPatToken(undefined as unknown as string)).toBe(false);
    });
  });

  // ─── verify ─────────────────────────────────────────────────────────────

  describe('verify', () => {
    const token = 'pat_alice_a'.padEnd(40, 'b');

    it('returns null when token does not have pat_ prefix', async () => {
      const result = await service.verify('not-a-pat-token');
      expect(result).toBeNull();
      expect(mockPrisma.personalAccessToken.findUnique).not.toHaveBeenCalled();
    });

    it('returns null when token hash is not found in db', async () => {
      mockPrisma.personalAccessToken.findUnique.mockResolvedValue(null);

      const result = await service.verify(token);

      expect(result).toBeNull();
      expect(mockPrisma.personalAccessToken.findUnique).toHaveBeenCalledTimes(1);
      // 必须用 tokenHash 查询(不是明文 token)
      const callArg = mockPrisma.personalAccessToken.findUnique.mock.calls[0]?.[0];
      expect(callArg).toEqual(
        expect.objectContaining({
          where: expect.objectContaining({ tokenHash: expect.any(String) }),
        })
      );
      // hash 必须是 64 字符 sha256 hex
      expect((callArg as { where: { tokenHash: string } }).where.tokenHash).toMatch(
        /^[a-f0-9]{64}$/
      );
    });

    it('returns null for revoked token', async () => {
      mockPrisma.personalAccessToken.findUnique.mockResolvedValue({
        id: 'pat-1',
        employeeId: 'emp-1',
        revokedAt: new Date('2026-01-01'),
        expiresAt: null,
      });

      const result = await service.verify(token);

      expect(result).toBeNull();
    });

    it('returns null for expired token', async () => {
      const pastDate = new Date(Date.now() - 60_000);
      mockPrisma.personalAccessToken.findUnique.mockResolvedValue({
        id: 'pat-2',
        employeeId: 'emp-2',
        revokedAt: null,
        expiresAt: pastDate,
      });

      const result = await service.verify(token);

      expect(result).toBeNull();
    });

    it('returns employeeId + patId for valid non-expired token', async () => {
      mockPrisma.personalAccessToken.findUnique.mockResolvedValue({
        id: 'pat-3',
        employeeId: 'emp-3',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      mockPrisma.personalAccessToken.update.mockResolvedValue({ id: 'pat-3' });

      const result = await service.verify(token, '1.2.3.4');

      expect(result).toEqual({ employeeId: 'emp-3', patId: 'pat-3' });
    });

    it('returns valid result when expiresAt is null (永不过期)', async () => {
      mockPrisma.personalAccessToken.findUnique.mockResolvedValue({
        id: 'pat-4',
        employeeId: 'emp-4',
        revokedAt: null,
        expiresAt: null,
      });
      mockPrisma.personalAccessToken.update.mockResolvedValue({ id: 'pat-4' });

      const result = await service.verify(token);

      expect(result).toEqual({ employeeId: 'emp-4', patId: 'pat-4' });
    });

    it('updates lastUsedAt/lastUsedIp asynchronously (best effort)', async () => {
      mockPrisma.personalAccessToken.findUnique.mockResolvedValue({
        id: 'pat-5',
        employeeId: 'emp-5',
        revokedAt: null,
        expiresAt: null,
      });
      mockPrisma.personalAccessToken.update.mockResolvedValue({ id: 'pat-5' });

      await service.verify(token, '10.0.0.1');

      // 等待 microtask 让 .catch() 链路完成
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockPrisma.personalAccessToken.update).toHaveBeenCalledTimes(1);
      const updateArg = mockPrisma.personalAccessToken.update.mock.calls[0]?.[0];
      expect(updateArg).toEqual(
        expect.objectContaining({
          where: { id: 'pat-5' },
          data: expect.objectContaining({
            lastUsedAt: expect.any(Date),
            lastUsedIp: '10.0.0.1',
          }),
        })
      );
    });

    it('lastUsedIp defaults to null when ip is not provided', async () => {
      mockPrisma.personalAccessToken.findUnique.mockResolvedValue({
        id: 'pat-6',
        employeeId: 'emp-6',
        revokedAt: null,
        expiresAt: null,
      });
      mockPrisma.personalAccessToken.update.mockResolvedValue({ id: 'pat-6' });

      await service.verify(token);
      await new Promise((resolve) => setImmediate(resolve));

      const updateArg = mockPrisma.personalAccessToken.update.mock.calls[0]?.[0] as
        | { data: { lastUsedIp: string | null } }
        | undefined;
      expect(updateArg?.data.lastUsedIp).toBeNull();
    });

    it('swallows update errors silently (verification still succeeds)', async () => {
      mockPrisma.personalAccessToken.findUnique.mockResolvedValue({
        id: 'pat-7',
        employeeId: 'emp-7',
        revokedAt: null,
        expiresAt: null,
      });
      mockPrisma.personalAccessToken.update.mockRejectedValue(new Error('db down'));

      const result = await service.verify(token);
      await new Promise((resolve) => setImmediate(resolve));

      // verify 仍返回成功结果,即使 lastUsed 更新失败
      expect(result).toEqual({ employeeId: 'emp-7', patId: 'pat-7' });
    });
  });

  // ─── issueByEmployeeId ──────────────────────────────────────────────────

  describe('issueByEmployeeId', () => {
    const currentUser = { id: 'admin-1' };

    it('never issues a PAT for the protected Employee ID', async () => {
      await expect(
        service.issueByEmployeeId({
          employeeId: protectedEmployeeId,
          name: 'forbidden',
          expiresAt: null,
          currentUser,
        })
      ).rejects.toThrow('受保护账号');
      expect(mockPrisma.personalAccessToken.create).not.toHaveBeenCalled();
    });

    it('rejects PAT issuance when the locked Employee was soft-deleted', async () => {
      const sessionsService = (service as unknown as { sessionsService: SessionsService })
        .sessionsService;
      vi.mocked(sessionsService.lockEmployeesForCredentials).mockResolvedValueOnce(
        new Map([
          ['emp-deleted', { id: 'emp-deleted', tokenInvalidAfter: null, deletedAt: new Date() }],
          ['admin-1', { id: 'admin-1', tokenInvalidAfter: null, deletedAt: null }],
        ])
      );

      await expect(
        service.issueByEmployeeId({
          employeeId: 'emp-deleted',
          name: 'must-not-survive-restore',
          expiresAt: null,
          currentUser,
        })
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.employee.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.personalAccessToken.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when employee does not exist', async () => {
      mockPrisma.employee.findUnique.mockResolvedValue(null);

      await expect(
        service.issueByEmployeeId({
          employeeId: 'missing',
          name: 'agent-token',
          expiresAt: null,
          currentUser,
        })
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.personalAccessToken.create).not.toHaveBeenCalled();
    });

    it('returns plaintext token + db record on success', async () => {
      mockPrisma.employee.findUnique.mockResolvedValue({
        id: 'emp-issue-1',
        username: 'alice',
      });
      const expiresAt = new Date('2027-01-01');
      mockPrisma.personalAccessToken.create.mockResolvedValue({
        id: 'pat-issue-1',
        prefix: 'pat_alice_aaaaaaaa',
        name: 'agent-token',
        expiresAt,
        createdAt: new Date('2026-05-16'),
      });

      const result = await service.issueByEmployeeId({
        employeeId: 'emp-issue-1',
        name: 'agent-token',
        expiresAt,
        currentUser,
      });

      expect(result.id).toBe('pat-issue-1');
      expect(result.name).toBe('agent-token');
      expect(result.expiresAt).toEqual(expiresAt);
      // 明文 token 以 pat_ 开头并包含安全 username
      expect(result.token).toMatch(/^pat_alice_[a-f0-9]{32}$/);
      // prefix 是 token 的前缀部分(头 + username + 前 8 位随机)
      expect(result.prefix).toMatch(/^pat_alice_[a-f0-9]{8}$/);
      const auditCall = mockPrisma.operationLog.create.mock.calls[0]?.[0];
      expect(auditCall).toEqual({
        data: {
          employeeId: 'admin-1',
          module: 'security',
          action: 'issue',
          target: 'pat-issue-1',
          details: {
            employeeId: 'emp-issue-1',
            expiresAt,
          },
        },
      });
      expect(JSON.stringify(auditCall?.data.details)).not.toMatch(/password|hash|token/i);
    });

    it('fails issuance when the transactional audit write fails', async () => {
      mockPrisma.employee.findUnique.mockResolvedValue({ id: 'emp-audit-fail', username: 'alice' });
      mockPrisma.personalAccessToken.create.mockResolvedValue({
        id: 'pat-audit-fail',
        prefix: 'pat_alice_aaaaaaaa',
        name: 'agent',
        expiresAt: null,
        createdAt: new Date(),
      });
      mockPrisma.operationLog.create.mockRejectedValue(new Error('audit unavailable'));

      await expect(
        service.issueByEmployeeId({
          employeeId: 'emp-audit-fail',
          name: 'agent',
          expiresAt: null,
          currentUser,
        })
      ).rejects.toThrow('audit unavailable');
      expect(mockPrisma.personalAccessToken.create).toHaveBeenCalledOnce();
    });

    it('writes tokenHash (sha256 hex) to db, NOT plaintext token', async () => {
      mockPrisma.employee.findUnique.mockResolvedValue({
        id: 'emp-issue-2',
        username: 'bob',
      });
      mockPrisma.personalAccessToken.create.mockResolvedValue({
        id: 'pat-issue-2',
        prefix: 'pat_bob_xxx',
        name: 'n',
        expiresAt: null,
        createdAt: new Date(),
      });

      const result = await service.issueByEmployeeId({
        employeeId: 'emp-issue-2',
        name: 'n',
        expiresAt: null,
        currentUser,
      });

      const createArg = mockPrisma.personalAccessToken.create.mock.calls[0]?.[0] as {
        data: { tokenHash: string };
      };
      expect(createArg.data.tokenHash).toMatch(/^[a-f0-9]{64}$/);
      // 关键安全:DB 中存的不能是明文 token
      expect(createArg.data.tokenHash).not.toBe(result.token);
    });

    it('sanitizes username (strips special chars from token middle segment)', async () => {
      mockPrisma.employee.findUnique.mockResolvedValue({
        id: 'emp-issue-3',
        username: 'alice@example.com',
      });
      mockPrisma.personalAccessToken.create.mockResolvedValue({
        id: 'pat-issue-3',
        prefix: 'pat_aliceexamplecom_xxxxxxxx',
        name: 'n',
        expiresAt: null,
        createdAt: new Date(),
      });

      const result = await service.issueByEmployeeId({
        employeeId: 'emp-issue-3',
        name: 'n',
        expiresAt: null,
        currentUser,
      });

      // @ 和 . 应被清掉
      expect(result.token).not.toContain('@');
      expect(result.token).not.toContain('.');
      // 但 _ 和 - 应保留(safeUsername 允许 a-zA-Z0-9_-)
      expect(result.token).toContain('aliceexamplecom');
    });

    it('falls back to emp<id> when username is null', async () => {
      mockPrisma.employee.findUnique.mockResolvedValue({
        id: 'abcdef1234567890',
        username: null,
      });
      mockPrisma.personalAccessToken.create.mockResolvedValue({
        id: 'pat-issue-4',
        prefix: 'pat_empabcdef12_yyyyyyyy',
        name: 'n',
        expiresAt: null,
        createdAt: new Date(),
      });

      const result = await service.issueByEmployeeId({
        employeeId: 'abcdef1234567890',
        name: 'n',
        expiresAt: null,
        currentUser,
      });

      // username 为 null 时用 emp<id 前 8 位> 兜底
      expect(result.token).toContain('empabcdef12');
    });

    it('accepts null expiresAt (永不过期 PAT)', async () => {
      mockPrisma.employee.findUnique.mockResolvedValue({
        id: 'emp-5',
        username: 'never',
      });
      mockPrisma.personalAccessToken.create.mockResolvedValue({
        id: 'pat-5',
        prefix: 'pat_never_zz',
        name: 'never-expire',
        expiresAt: null,
        createdAt: new Date(),
      });

      const result = await service.issueByEmployeeId({
        employeeId: 'emp-5',
        name: 'never-expire',
        expiresAt: null,
        currentUser,
      });

      expect(result.expiresAt).toBeNull();
      const createArg = mockPrisma.personalAccessToken.create.mock.calls[0]?.[0] as {
        data: { expiresAt: Date | null };
      };
      expect(createArg.data.expiresAt).toBeNull();
    });

    it('records audit fields (createdBy)', async () => {
      mockPrisma.employee.findUnique.mockResolvedValue({
        id: 'emp-6',
        username: 'audit',
      });
      mockPrisma.personalAccessToken.create.mockResolvedValue({
        id: 'pat-6',
        prefix: 'pat_audit_xxx',
        name: 'n',
        expiresAt: null,
        createdAt: new Date(),
      });

      await service.issueByEmployeeId({
        employeeId: 'emp-6',
        name: 'n',
        expiresAt: null,
        currentUser: { id: 'admin-x', employeeId: 'emp-admin-x' },
      });

      const createArg = mockPrisma.personalAccessToken.create.mock.calls[0]?.[0] as {
        data: Record<string, unknown>;
      };
      // auditCreateOnly 写入 creatorEmployeeId
      expect(createArg.data).toHaveProperty('creatorEmployeeId');
    });
  });

  // ─── listByEmployee ─────────────────────────────────────────────────────

  describe('listByEmployee', () => {
    it('queries by employeeId with desc createdAt order', async () => {
      const fakeRows = [
        {
          id: 'pat-a',
          name: 'first',
          prefix: 'pat_x_111',
          lastUsedAt: null,
          lastUsedIp: null,
          expiresAt: null,
          revokedAt: null,
          createdAt: new Date('2026-05-01'),
        },
      ];
      mockPrisma.personalAccessToken.findMany.mockResolvedValue(fakeRows);

      const result = await service.listByEmployee('emp-list');

      expect(result).toEqual(fakeRows);
      const findArg = mockPrisma.personalAccessToken.findMany.mock.calls[0]?.[0];
      expect(findArg).toEqual(
        expect.objectContaining({
          where: { employeeId: 'emp-list' },
          orderBy: { createdAt: 'desc' },
        })
      );
    });

    it('returns empty array when no PAT exists', async () => {
      mockPrisma.personalAccessToken.findMany.mockResolvedValue([]);

      const result = await service.listByEmployee('no-pat');

      expect(result).toEqual([]);
    });

    it('does NOT select tokenHash in response (security)', async () => {
      mockPrisma.personalAccessToken.findMany.mockResolvedValue([]);

      await service.listByEmployee('emp-1');

      const findArg = mockPrisma.personalAccessToken.findMany.mock.calls[0]?.[0] as {
        select: Record<string, boolean>;
      };
      expect(findArg.select).not.toHaveProperty('tokenHash');
      expect(findArg.select).toHaveProperty('id', true);
      expect(findArg.select).toHaveProperty('prefix', true);
    });
  });

  // ─── listAll ────────────────────────────────────────────────────────────

  describe('listAll', () => {
    it('returns rows with embedded employee info', async () => {
      const rows = [
        {
          id: 'pat-z',
          name: 'admin-token',
          prefix: 'pat_admin_z',
          lastUsedAt: null,
          lastUsedIp: null,
          expiresAt: null,
          revokedAt: null,
          createdAt: new Date(),
          employee: { id: 'emp-z', username: 'admin', name: '系统管理员' },
        },
      ];
      mockPrisma.personalAccessToken.findMany.mockResolvedValue(rows);

      const result = await service.listAll();

      expect(result).toEqual(rows);
      const findArg = mockPrisma.personalAccessToken.findMany.mock.calls[0]?.[0] as {
        select: Record<string, unknown>;
      };
      expect(findArg.select).toHaveProperty('employee');
      expect(findArg.select).not.toHaveProperty('tokenHash');
    });
  });

  // ─── revoke ─────────────────────────────────────────────────────────────

  describe('revoke', () => {
    it('throws NotFoundException when PAT does not exist', async () => {
      mockPrisma.personalAccessToken.findUnique.mockResolvedValue(null);

      await expect(service.revoke('missing-pat', { id: 'admin-1' })).rejects.toThrow(
        NotFoundException
      );
      expect(mockPrisma.personalAccessToken.update).not.toHaveBeenCalled();
    });

    it('is idempotent: returns silently when already revoked', async () => {
      mockPrisma.personalAccessToken.findUnique.mockResolvedValue({
        id: 'pat-revoked',
        employeeId: 'emp-1',
        revokedAt: new Date('2026-01-01'),
      });

      await expect(service.revoke('pat-revoked', { id: 'admin-1' })).resolves.toBeUndefined();
      expect(mockPrisma.personalAccessToken.update).not.toHaveBeenCalled();
    });

    it('sets revokedAt for active PAT', async () => {
      mockPrisma.personalAccessToken.findUnique.mockResolvedValue({
        id: 'pat-active',
        employeeId: 'emp-1',
        revokedAt: null,
      });
      mockPrisma.personalAccessToken.update.mockResolvedValue({ id: 'pat-active' });

      await service.revoke('pat-active', { id: 'admin-1', employeeId: 'emp-admin-1' });

      expect(mockPrisma.personalAccessToken.update).toHaveBeenCalledTimes(1);
      const updateArg = mockPrisma.personalAccessToken.update.mock.calls[0]?.[0] as {
        where: { id: string };
        data: { revokedAt: Date };
      };
      expect(updateArg.where).toEqual({ id: 'pat-active' });
      expect(updateArg.data.revokedAt).toBeInstanceOf(Date);
      expect(mockPrisma.operationLog.create).toHaveBeenCalledWith({
        data: {
          employeeId: 'emp-admin-1',
          module: 'security',
          action: 'revoke',
          target: 'pat-active',
          details: { employeeId: 'emp-1' },
        },
      });
    });

    it('fails revocation when the transactional audit write fails', async () => {
      mockPrisma.personalAccessToken.findUnique.mockResolvedValue({
        id: 'pat-active',
        employeeId: 'emp-1',
        revokedAt: null,
      });
      mockPrisma.personalAccessToken.update.mockResolvedValue({ id: 'pat-active' });
      mockPrisma.operationLog.create.mockRejectedValue(new Error('audit unavailable'));

      await expect(service.revoke('pat-active', { id: 'admin-1' })).rejects.toThrow(
        'audit unavailable'
      );
      expect(mockPrisma.personalAccessToken.update).toHaveBeenCalledOnce();
    });
  });
});
