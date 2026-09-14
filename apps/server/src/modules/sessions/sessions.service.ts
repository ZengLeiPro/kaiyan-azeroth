import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import * as crypto from 'crypto';

import { PrismaService } from '@/common/prisma/prisma.service';

import { CreateSessionDto, SessionResponseDto } from './dto/session.dto';

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 对 refreshToken 进行 SHA-256 哈希。
   * refresh 轮换需要用该值做数据库 CAS，故作为模块内公共 primitive 暴露。
   */
  hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * 所有凭据签发、轮换和强制撤销都先锁同一 Employee 行。
   */
  async lockEmployeeForCredentials(
    tx: Prisma.TransactionClient,
    employeeId: string
  ): Promise<{ id: string; tokenInvalidAfter: Date | null; deletedAt: Date | null } | null> {
    // @prisma-raw-sql: Prisma 不支持 SELECT FOR UPDATE；凭据签发与撤销必须在同一 Employee 行上串行化。
    const rows = await tx.$queryRaw<
      Array<{ id: string; tokenInvalidAfter: Date | null; deletedAt: Date | null }>
    >`SELECT "id", "tokenInvalidAfter", "deletedAt" FROM "employees" WHERE "id" = ${employeeId} FOR UPDATE`;
    return rows[0] ?? null;
  }

  /**
   * 涉及目标员工与审计操作者 FK 的事务按 Employee ID 排序预锁，
   * 避免管理员交叉操作时形成「目标 FOR UPDATE → 操作者 FK KEY SHARE」反向环。
   */
  async lockEmployeesForCredentials(
    tx: Prisma.TransactionClient,
    employeeIds: readonly string[]
  ): Promise<Map<string, { id: string; tokenInvalidAfter: Date | null; deletedAt: Date | null }>> {
    const locked = new Map<
      string,
      { id: string; tokenInvalidAfter: Date | null; deletedAt: Date | null }
    >();
    for (const employeeId of [...new Set(employeeIds)].sort()) {
      const employee = await this.lockEmployeeForCredentials(tx, employeeId);
      if (employee) locked.set(employeeId, employee);
    }
    return locked;
  }

  /** refresh 轮换在 Employee 锁之后再锁当前 Session，保持全局固定锁序。 */
  async lockSessionForRefresh(tx: Prisma.TransactionClient, sessionId: string): Promise<boolean> {
    // @prisma-raw-sql: Prisma 不支持 SELECT FOR UPDATE；显式锁定当前 Session 防止并发 refresh 双刷。
    const rows = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT "id" FROM "sessions" WHERE "id" = ${sessionId} FOR UPDATE`;
    return rows.length === 1;
  }

  /**
   * 已持有 Employee 行锁时仅撤销交互式凭据。固定写入顺序为 Employee → Session；
   * 适用于临时锁定账号等不应影响长期 PAT 的场景。
   */
  async revokeInteractiveCredentialsInTransaction(
    tx: Prisma.TransactionClient,
    employeeId: string,
    previousTokenInvalidAfter: Date | null
  ): Promise<{ tokenInvalidAfter: Date; revokedSessions: number }> {
    const now = Date.now();
    const previous = previousTokenInvalidAfter?.getTime() ?? 0;
    const tokenInvalidAfter = new Date(Math.max(now, previous + 1));

    await tx.employee.update({
      where: { id: employeeId },
      data: { tokenInvalidAfter },
    });
    const sessions = await tx.session.deleteMany({ where: { employeeId } });

    return {
      tokenInvalidAfter,
      revokedSessions: sessions.count,
    };
  }

  /**
   * 已持有 Employee 行锁时执行凭据撤销。固定写入顺序为 Employee → Session → PAT；
   * 调用方可把安全状态变更和审计日志一起纳入同一事务。
   */
  async revokeAllCredentialsInTransaction(
    tx: Prisma.TransactionClient,
    employeeId: string,
    previousTokenInvalidAfter: Date | null
  ): Promise<{ tokenInvalidAfter: Date; revokedSessions: number; revokedPats: number }> {
    const now = Date.now();
    const previous = previousTokenInvalidAfter?.getTime() ?? 0;
    const tokenInvalidAfter = new Date(Math.max(now, previous + 1));

    await tx.employee.update({
      where: { id: employeeId },
      data: { tokenInvalidAfter },
    });
    const sessions = await tx.session.deleteMany({ where: { employeeId } });
    const pats = await tx.personalAccessToken.updateMany({
      where: { employeeId, revokedAt: null },
      data: { revokedAt: tokenInvalidAfter },
    });

    return {
      tokenInvalidAfter,
      revokedSessions: sessions.count,
      revokedPats: pats.count,
    };
  }

  /**
   * Employee 凭据统一强制撤销 primitive。
   * 调用方的安全字段变更与 tokenInvalidAfter、Session、PAT 撤销处于同一事务和行锁内。
   * 如业务域有先于 Employee 行锁的全局锁，必须通过 beforeEmployeeLock 在同一事务先获取。
   */
  async revokeAllCredentials<T = undefined>(
    employeeId: string,
    mutate?: (
      tx: Prisma.TransactionClient,
      locked: { id: string; tokenInvalidAfter: Date | null; deletedAt: Date | null }
    ) => Promise<T>,
    relatedEmployeeIds: readonly string[] = [],
    beforeEmployeeLock?: (tx: Prisma.TransactionClient) => Promise<void>
  ): Promise<{
    value: T;
    tokenInvalidAfter: Date;
    revokedSessions: number;
    revokedPats: number;
  }> {
    return this.prisma.$transaction(async (tx) => {
      if (beforeEmployeeLock) await beforeEmployeeLock(tx);
      const lockedEmployees = await this.lockEmployeesForCredentials(tx, [
        employeeId,
        ...relatedEmployeeIds,
      ]);
      const locked = lockedEmployees.get(employeeId);
      if (!locked) throw new NotFoundException('用户不存在');

      const value = mutate ? await mutate(tx, locked) : (undefined as T);
      const revoked = await this.revokeAllCredentialsInTransaction(
        tx,
        employeeId,
        locked.tokenInvalidAfter
      );

      return { value, ...revoked };
    });
  }

  /**
   * 获取员工的所有会话（push 6: 单写 employeeId）
   */
  async findAllByUserId(userId: string, currentToken?: string): Promise<SessionResponseDto[]> {
    const sessions = await this.prisma.session.findMany({
      where: { employeeId: userId },
      orderBy: { lastActiveTime: 'desc' },
    });

    const currentTokenHash = currentToken ? this.hashToken(currentToken) : '';

    return sessions.map((session) => ({
      id: session.id,
      userId: session.employeeId,
      deviceType: session.deviceType,
      deviceName: session.deviceName,
      browser: session.browser,
      os: session.os,
      ipAddress: session.ipAddress,
      location: session.location,
      loginTime: session.loginTime,
      lastActiveTime: session.lastActiveTime,
      isCurrent: currentToken ? session.refreshToken === currentTokenHash : false,
    }));
  }

  /**
   * 创建会话（存储哈希后的 refreshToken）
   */
  async createSession(
    data: CreateSessionDto & { loginTime?: Date },
    sessionId?: string,
    tx?: Prisma.TransactionClient
  ) {
    const client = tx ?? this.prisma;
    return client.session.create({
      data: {
        ...(sessionId ? { id: sessionId } : {}),
        employeeId: data.employeeId,
        deviceType: data.deviceType,
        deviceName: data.deviceName,
        browser: data.browser,
        os: data.os,
        ipAddress: data.ipAddress,
        location: data.location,
        refreshToken: this.hashToken(data.refreshToken),
        expiresAt: data.expiresAt,
        ...(data.loginTime ? { loginTime: data.loginTime } : {}),
      },
    });
  }

  /**
   * 删除指定会话
   */
  async deleteSession(id: string, userId: string, currentToken?: string) {
    const session = await this.prisma.session.findUnique({
      where: { id },
    });

    if (!session) {
      throw new NotFoundException('会话不存在');
    }

    // push 6: sessions 仅有 employeeId 列
    if (session.employeeId !== userId) {
      throw new ForbiddenException('无权操作此会话');
    }

    // 检查是否为当前会话
    if (currentToken && session.refreshToken === this.hashToken(currentToken)) {
      throw new ForbiddenException('不能注销当前会话');
    }

    await this.prisma.session.delete({
      where: { id },
    });

    return { success: true };
  }

  /**
   * 删除用户的所有其他会话（保留当前会话）
   */
  async deleteOtherSessions(userId: string, currentToken: string) {
    // push 6: sessions 仅 employeeId 维度
    const result = await this.prisma.session.deleteMany({
      where: {
        employeeId: userId,
        refreshToken: { not: this.hashToken(currentToken) },
      },
    });

    return { deletedCount: result.count };
  }

  /**
   * 更新最后活跃时间
   */
  async updateLastActiveTime(refreshToken: string) {
    try {
      await this.prisma.session.update({
        where: { refreshToken: this.hashToken(refreshToken) },
        data: { lastActiveTime: new Date() },
      });
    } catch {
      // 会话可能已过期或不存在，忽略错误
    }
  }

  /**
   * 根据 refreshToken 查找会话
   */
  async findByRefreshToken(refreshToken: string) {
    return this.prisma.session.findUnique({
      where: { refreshToken: this.hashToken(refreshToken) },
    });
  }

  /**
   * 更新会话的 refreshToken（用于 token 轮换）
   */
  async updateRefreshToken(oldToken: string, newToken: string, newExpiresAt: Date) {
    await this.prisma.session.update({
      where: { refreshToken: this.hashToken(oldToken) },
      data: {
        refreshToken: this.hashToken(newToken),
        expiresAt: newExpiresAt,
        lastActiveTime: new Date(),
      },
    });
  }

  /** 按 access token 的 jti 删除当前员工会话。 */
  async deleteCurrentSession(employeeId: string, sessionId: string) {
    const result = await this.prisma.session.deleteMany({
      where: { id: sessionId, employeeId },
    });
    return { success: result.count === 1 };
  }

  /**
   * 根据 refreshToken 删除会话
   */
  async deleteByRefreshToken(refreshToken: string) {
    try {
      await this.prisma.session.delete({
        where: { refreshToken: this.hashToken(refreshToken) },
      });
      return { success: true };
    } catch {
      // 会话可能已不存在，忽略错误
      return { success: true };
    }
  }

  /**
   * 删除用户的所有会话
   */
  async deleteAllByUserId(userId: string, excludeSessionId?: string) {
    // push 6: sessions 仅 employeeId 维度
    const where: Prisma.SessionWhereInput = { employeeId: userId };
    if (excludeSessionId) {
      where.id = { not: excludeSessionId };
    }
    return this.prisma.session.deleteMany({ where });
  }

  /**
   * 清理过期会话
   */
  async cleanExpiredSessions() {
    const result = await this.prisma.session.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });

    return { deletedCount: result.count };
  }

  /**
   * 定时清理过期会话（每天凌晨 3 点）
   */
  @Cron('0 3 * * *')
  async handleExpiredSessionCleanup() {
    const result = await this.cleanExpiredSessions();
    if (result.deletedCount > 0) {
      this.logger.log(`清理了 ${result.deletedCount} 个过期会话`);
    }
  }
}
