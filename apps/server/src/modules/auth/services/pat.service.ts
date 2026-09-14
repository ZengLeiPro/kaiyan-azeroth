import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { auditCreateOnly } from '../../../common/utils/audit-helper';
import { toJsonValue } from '../../../common/utils/json-type-helpers';
import { SessionsService } from '../../sessions/sessions.service';
import { assertEmployeeIsNotProtected } from '../guards/protected-employee';

export interface PatVerifyResult {
  /** push 6: 仅 employeeId（user 表已删） */
  employeeId: string;
  patId: string;
}

export interface PatIssueResult {
  id: string;
  token: string; // 明文，仅在签发时返回一次
  prefix: string;
  name: string;
  expiresAt: Date | null;
  createdAt: Date;
}

/** PAT 列表项（不含 hash） */
export interface PatListItem {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: Date | null;
  lastUsedIp: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  /** push 6: 关联 employee（用户名取自 employee.username） */
  employee?: { id: string; username: string | null; name: string } | null;
}

const PAT_PREFIX_HEAD = 'pat_';
const PAT_RANDOM_BYTES = 16; // → 32 位 hex

@Injectable()
export class PatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionsService: SessionsService
  ) {}

  /**
   * 判断字符串是否疑似 PAT（用于鉴权 guard 的快速分支判定）
   */
  isPatToken(token: string): boolean {
    return typeof token === 'string' && token.startsWith(PAT_PREFIX_HEAD);
  }

  /**
   * 校验 PAT，命中且未吊销/未过期则返回 employeeId。
   * 同步更新 lastUsedAt / lastUsedIp（best effort，不阻塞）。
   */
  async verify(token: string, ip?: string): Promise<PatVerifyResult | null> {
    if (!this.isPatToken(token)) return null;
    const tokenHash = this.hash(token);
    const record = await this.prisma.personalAccessToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        employeeId: true,
        revokedAt: true,
        expiresAt: true,
      },
    });
    if (!record) return null;
    if (record.revokedAt) return null;
    if (record.expiresAt && record.expiresAt < new Date()) return null;

    // 异步更新 lastUsed，不影响请求路径
    this.prisma.personalAccessToken
      .update({
        where: { id: record.id },
        data: { lastUsedAt: new Date(), lastUsedIp: ip ?? null },
      })
      .catch(() => {
        /* swallow */
      });

    return {
      employeeId: record.employeeId,
      patId: record.id,
    };
  }

  /**
   * 签发新 PAT。明文 token 仅本次返回，DB 仅存 hash + prefix。
   * @param employeeId 关联员工
   * @param name 用途描述，如 "agent-ops-bot"
   * @param expiresAt null = 不过期
   * @param currentUser 操作人
   */
  async issueByEmployeeId(params: {
    employeeId: string;
    name: string;
    expiresAt: Date | null;
    currentUser: { id: string; employeeId?: string | null };
  }): Promise<PatIssueResult> {
    const { employeeId, name, expiresAt, currentUser } = params;
    assertEmployeeIsNotProtected(employeeId);

    return this.prisma.$transaction(async (tx) => {
      // 与密码修改/禁用/删除的统一撤销使用同一 Employee 锁，PAT 签发因此可线性化。
      const lockedEmployees = await this.sessionsService.lockEmployeesForCredentials(tx, [
        employeeId,
        currentUser.employeeId ?? currentUser.id,
      ]);
      const locked = lockedEmployees.get(employeeId);
      if (!locked || locked.deletedAt) throw new NotFoundException('员工不存在');
      const employee = await tx.employee.findUnique({
        where: { id: employeeId, deletedAt: null },
        select: { id: true, username: true },
      });
      if (!employee) throw new NotFoundException('员工不存在');

      const random = randomBytes(PAT_RANDOM_BYTES).toString('hex');
      const usernameSource = employee.username ?? `emp${employee.id.slice(0, 8)}`;
      const safeUsername = usernameSource.replace(/[^a-zA-Z0-9_-]/g, '');
      const token = `${PAT_PREFIX_HEAD}${safeUsername}_${random}`;
      const prefix = `${PAT_PREFIX_HEAD}${safeUsername}_${random.slice(0, 8)}`;
      const tokenHash = this.hash(token);
      const created = await tx.personalAccessToken.create({
        data: {
          employeeId: employee.id,
          name,
          tokenHash,
          prefix,
          expiresAt: expiresAt ?? null,
          ...auditCreateOnly(currentUser),
        },
        select: {
          id: true,
          prefix: true,
          name: true,
          expiresAt: true,
          createdAt: true,
        },
      });
      await tx.operationLog.create({
        data: {
          employeeId: currentUser.employeeId ?? currentUser.id,
          module: 'security',
          action: 'issue',
          target: created.id,
          details: toJsonValue({
            employeeId: employee.id,
            expiresAt: created.expiresAt,
          }),
        },
      });

      return {
        id: created.id,
        token,
        prefix: created.prefix,
        name: created.name,
        expiresAt: created.expiresAt,
        createdAt: created.createdAt,
      };
    });
  }

  /**
   * 列出某员工的所有 PAT（不返回 hash，只返回元数据）
   */
  async listByEmployee(employeeId: string) {
    return this.prisma.personalAccessToken.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        prefix: true,
        lastUsedAt: true,
        lastUsedIp: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });
  }

  /**
   * 列出全部 PAT，含所属员工信息（admin 用）
   */
  async listAll() {
    return this.prisma.personalAccessToken.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        prefix: true,
        lastUsedAt: true,
        lastUsedIp: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
        employee: { select: { id: true, username: true, name: true } },
      },
    });
  }

  /**
   * 吊销 PAT（软删除）
   */
  async revoke(id: string, currentUser: { id: string; employeeId?: string | null }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const record = await tx.personalAccessToken.findUnique({
        where: { id },
        select: { id: true, employeeId: true, revokedAt: true },
      });
      if (!record) throw new NotFoundException('PAT 不存在');
      if (record.revokedAt) return; // 幂等
      await tx.personalAccessToken.update({
        where: { id },
        data: { revokedAt: new Date() },
      });
      await tx.operationLog.create({
        data: {
          employeeId: currentUser.employeeId ?? currentUser.id,
          module: 'security',
          action: 'revoke',
          target: record.id,
          details: toJsonValue({ employeeId: record.employeeId }),
        },
      });
    });
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
