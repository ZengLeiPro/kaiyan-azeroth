import type { UserResponseOutput } from '@ky-azeroth/shared/schemas';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

import type { PaginatedResponse } from '../../common/interfaces/pagination.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  authCacheKeysFor,
  EmployeePermissionCacheService,
  scopeCacheKeyPrefixFor,
} from '../../common/services/employee-permission-cache.service';
import { auditUpdate } from '../../common/utils/audit-helper';
import { toJsonValue } from '../../common/utils/json-type-helpers';
import { calculatePagination, serializeEntity } from '../../common/utils/response-helpers';
import {
  assertEmployeeIsNotProtected,
  assertUsernameIsNotReserved,
} from '../auth/guards/protected-employee';
import { assertPermissionsWithinActorScope, mergePermissionSlices } from '../auth/permission-scope';
import { lockEmployeeDepartmentWrites } from '../departments/employee-department-lock';
import {
  lockAndAssertEmployeeLoginIdentifiersAvailable,
  normalizeEmployeeLoginIdentifier,
} from '../employees/employee-login-identifier';
import { SessionsService } from '../sessions/sessions.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

/**
 * push 6: User 表已删除，UsersService 现在本质是 "employee with login" 视图。
 * 所有 prisma.user.* 调用改成 prisma.employee.*；employee.id 即原 user.id。
 *
 * 历史接口形状（findAll/findOne 返回的 UserResponseOutput）保持向后兼容，
 * 让 controller / DTO 不用大改。
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionsService: SessionsService,
    private readonly authCache: EmployeePermissionCacheService
  ) {}

  private invalidateAuthCache(employeeId: string): void {
    this.authCache.invalidateMany(authCacheKeysFor(employeeId));
    // viewScope 缓存按 (employee, module, menu) 三段,角色变化时一并按前缀清空
    this.authCache.invalidateByPrefix(scopeCacheKeyPrefixFor(employeeId));
  }

  private async assertRoleAssignmentAllowed(
    roleIds: string[],
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<void> {
    const actorEmployeeId = currentUser.employeeId ?? currentUser.id;

    const [actor, requestedRoles] = await Promise.all([
      this.prisma.employee.findUnique({
        where: { id: actorEmployeeId, deletedAt: null },
        select: {
          userRoles: {
            where: { role: { deletedAt: null, status: 'active' } },
            select: { role: { select: { permissions: true } } },
          },
        },
      }),
      this.prisma.role.findMany({
        where: { id: { in: [...new Set(roleIds)] }, deletedAt: null, status: 'active' },
        select: { id: true, code: true, permissions: true },
      }),
    ]);

    if (!actor || requestedRoles.length !== new Set(roleIds).size) {
      throw new ForbiddenException('包含无效或不可分配的角色');
    }

    const actorPermissions = mergePermissionSlices(
      actor.userRoles.flatMap((assignment) => assignment.role.permissions)
    );
    for (const role of requestedRoles) {
      assertPermissionsWithinActorScope(
        role.permissions,
        actorPermissions,
        '不能分配超出当前账号权限范围的角色'
      );
    }
  }

  private async writeSecurityAudit(
    tx: Prisma.TransactionClient,
    currentUser: { id: string; employeeId?: string | null },
    action: string,
    target: string,
    details: Record<string, unknown>
  ): Promise<void> {
    await tx.operationLog.create({
      data: {
        employeeId: currentUser.employeeId ?? currentUser.id,
        module: 'security',
        action,
        target,
        details: toJsonValue(details),
      },
    });
  }

  /**
   * 把一条 employee 记录（带 userRoles）映射成原 UserResponseOutput 形状
   */
  private mapEmployeeToUserResponse(
    employee: Prisma.EmployeeGetPayload<{
      include: {
        userRoles: {
          include: {
            role: { include: { permissions: true } };
          };
        };
      };
    }>
  ): UserResponseOutput {
    return serializeEntity<UserResponseOutput>({
      id: employee.id,
      username: employee.username ?? '',
      phone: employee.phone,
      email: employee.email,
      avatar: employee.avatar,
      employeeId: employee.id,
      status: employee.loginStatus,
      lastLoginAt: employee.lastLoginAt,
      lastLoginIp: employee.lastLoginIp,
      createdAt: employee.createdAt,
      updatedAt: employee.updatedAt,
      deletedAt: employee.deletedAt,
      version: employee.version,
      employee: { id: employee.id, name: employee.name },
      roles:
        employee.userRoles?.map((ur) => ({
          id: ur.role.id,
          name: ur.role.name,
          code: ur.role.code,
          permissions: ur.role.permissions,
        })) ?? [],
    });
  }

  /**
   * 创建用户（push 6: 在 employee 上设置登录字段）
   */
  async create(
    createUserDto: CreateUserDto,
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<UserResponseOutput> {
    const { username, phone, password, roleIds, employeeId, ...rest } = createUserDto;

    if (!employeeId) {
      throw new ConflictException('创建用户必须指定 employeeId（push 6: 直接给 employee 加登录）');
    }
    await this.assertRoleAssignmentAllowed(roleIds, currentUser);
    assertEmployeeIsNotProtected(employeeId);
    const normalizedUsername = normalizeEmployeeLoginIdentifier(username) ?? username;
    const normalizedPhone = normalizeEmployeeLoginIdentifier(phone);
    assertUsernameIsNotReserved(normalizedUsername);

    const hashedPassword = await bcrypt.hash(password, 12);

    // 给 employee 加登录字段时也统一撤销历史凭据，避免重新启用后旧 PAT/Session 复活。
    const { value: employee } = await this.sessionsService.revokeAllCredentials(
      employeeId,
      async (tx, locked) => {
        // revokeAllCredentials 已先锁 Employee 行；软删 owner 必须永久保留 identifier，禁止重新开通。
        if (locked.deletedAt) throw new NotFoundException('用户不存在');
        // 随后所有入口共用规范化 identifier 锁序。
        await lockAndAssertEmployeeLoginIdentifiersAvailable(
          tx,
          [normalizedUsername, normalizedPhone],
          employeeId
        );
        const updated = await tx.employee.update({
          where: { id: employeeId, deletedAt: null },
          data: {
            username: normalizedUsername,
            phone: normalizedPhone ?? undefined,
            email: rest.email ?? undefined,
            avatar: rest.avatar ?? undefined,
            password: hashedPassword,
            canLogin: true,
            loginStatus: 'active',
            loginFailCount: 0,
            lockUntil: null,
            ...auditUpdate(currentUser),
            userRoles: {
              deleteMany: {},
              create: roleIds.map((roleId) => ({ roleId })),
            },
          },
          include: {
            userRoles: { include: { role: { include: { permissions: true } } } },
          },
        });
        await this.writeSecurityAudit(tx, currentUser, 'create', employeeId, {
          username,
          status: 'active',
          roleIds,
        });
        return updated;
      },
      [currentUser.employeeId ?? currentUser.id]
    );

    this.invalidateAuthCache(employee.id);
    return this.mapEmployeeToUserResponse(employee);
  }

  /**
   * 查询用户列表（push 6: 列表 = 有 username 的 employee）
   */
  async findAll(query: {
    page?: number;
    pageSize?: number;
    keyword?: string;
    status?: string[];
    roleId?: string[];
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }): Promise<PaginatedResponse<UserResponseOutput>> {
    const {
      keyword,
      status,
      roleId,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      page = 1,
      pageSize = 10,
    } = query;
    const { skip } = calculatePagination(page, pageSize);

    const where: Prisma.EmployeeWhereInput = {
      deletedAt: null,
      username: { not: null },
    };

    if (keyword) {
      where.OR = [
        { username: { contains: keyword, mode: 'insensitive' } },
        { phone: { contains: keyword } },
        { email: { contains: keyword, mode: 'insensitive' } },
      ];
    }

    if (status?.length) {
      where.loginStatus = { in: status };
    }

    if (roleId?.length) {
      where.userRoles = { some: { roleId: { in: roleId } } };
    }

    // 兼容前端 sortBy='status'：实际 employee 字段是 loginStatus
    const sortField = sortBy === 'status' ? 'loginStatus' : sortBy;
    const orderBy = { [sortField]: sortOrder };

    const [total, employees] = await Promise.all([
      this.prisma.employee.count({ where }),
      this.prisma.employee.findMany({
        where,
        skip,
        take: pageSize,
        orderBy,
        include: {
          userRoles: { include: { role: { include: { permissions: true } } } },
        },
      }),
    ]);

    return {
      items: employees.map((e) => this.mapEmployeeToUserResponse(e)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 选择器场景
   */
  async findAllForSelection(query: {
    keyword?: string;
    status?: string;
    pageSize?: number;
  }): Promise<
    { id: string; username: string; phone: string | null; employeeName: string | null }[]
  > {
    const { keyword, status, pageSize = 100 } = query;
    const where: Prisma.EmployeeWhereInput = { deletedAt: null, username: { not: null } };

    if (keyword) {
      where.OR = [
        { username: { contains: keyword, mode: 'insensitive' } },
        { name: { contains: keyword, mode: 'insensitive' } },
      ];
    }
    if (status) {
      where.loginStatus = status;
    }

    const employees = await this.prisma.employee.findMany({
      where,
      take: pageSize,
      orderBy: { username: 'asc' },
      select: { id: true, username: true, phone: true, name: true },
    });

    return employees.map((e) => ({
      id: e.id,
      username: e.username ?? '',
      phone: e.phone,
      employeeName: e.name,
    }));
  }

  /**
   * 根据ID查询用户（id = employee.id）
   */
  async findOne(id: string): Promise<UserResponseOutput> {
    const employee = await this.prisma.employee.findFirst({
      where: { id, deletedAt: null },
      include: {
        userRoles: { include: { role: { include: { permissions: true } } } },
      },
    });

    if (!employee) {
      throw new NotFoundException('用户不存在');
    }

    return this.mapEmployeeToUserResponse(employee);
  }

  /**
   * 根据用户名查询（push 6: employee.username）
   */
  async findByUsername(username: string) {
    return this.prisma.employee.findFirst({
      where: {
        OR: [{ username }, { phone: username }],
        deletedAt: null,
      },
      include: {
        userRoles: { include: { role: { include: { permissions: true } } } },
      },
    });
  }

  /**
   * 更新用户
   */
  async update(
    id: string,
    updateUserDto: UpdateUserDto,
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<UserResponseOutput> {
    const {
      roleIds,
      version: requestVersion,
      employeeId: _ignoredEmployeeId,
      ...rest
    } = updateUserDto;
    void _ignoredEmployeeId;

    assertEmployeeIsNotProtected(id);
    const normalizedUsername =
      rest.username === undefined
        ? undefined
        : (normalizeEmployeeLoginIdentifier(rest.username) ?? rest.username);
    const normalizedPhone =
      rest.phone === undefined ? undefined : normalizeEmployeeLoginIdentifier(rest.phone);
    assertUsernameIsNotReserved(normalizedUsername);
    if (roleIds !== undefined) {
      await this.assertRoleAssignmentAllowed(roleIds, currentUser);
    }
    await this.findOne(id);

    // admin 重置密码路径：仅在请求体携带非空 password 时触发，沿用 create() 的
    // bcrypt cost=12，并比对 changePassword() 的副作用对齐（写 tokenInvalidAfter
    // 让旧 access token 立即失效，update 成功后吊销该用户所有 sessions）。
    let passwordChanged = false;
    let hashedPassword: string | undefined;
    if (rest.password) {
      hashedPassword = await bcrypt.hash(rest.password, 12);
      passwordChanged = true;
    }

    try {
      const data: Prisma.EmployeeUpdateInput = {
        ...auditUpdate(currentUser),
        version: { increment: 1 },
      };
      if (normalizedUsername !== undefined) data.username = normalizedUsername;
      if (normalizedPhone !== undefined) data.phone = normalizedPhone;
      if (rest.email !== undefined) data.email = rest.email;
      if (rest.avatar !== undefined) data.avatar = rest.avatar;
      // 同步 loginStatus + canLogin，与 updateStatus() 路径保持一致。
      // 鉴权门是 `loginStatus !== 'active' || !canLogin`（OR）——单改一边
      // 仍能拒绝登录，但会留下「半禁用」脏数据，前端 canLogin 列误显示
      // 为开通，并且后续切回 active 时只恢复 loginStatus 不会恢复 canLogin。
      if (rest.status !== undefined) {
        data.loginStatus = rest.status;
        data.canLogin = rest.status === 'active';
        if (rest.status === 'active') {
          data.loginFailCount = 0;
          data.lockUntil = null;
        }
      }
      if (passwordChanged && hashedPassword) {
        data.password = hashedPassword;
      }
      if (roleIds) {
        data.userRoles = {
          deleteMany: {},
          create: roleIds.map((roleId) => ({ roleId })),
        };
      }

      const changedSecurityFields = [
        ...(rest.username !== undefined ? ['username'] : []),
        ...(rest.phone !== undefined ? ['phone'] : []),
        ...(passwordChanged ? ['credential_secret'] : []),
        ...(rest.status !== undefined ? ['status'] : []),
        ...(roleIds !== undefined ? ['roles'] : []),
      ];
      const changesLoginIdentifier =
        normalizedUsername !== undefined || normalizedPhone !== undefined;
      const updateEmployee = async (
        client: Prisma.TransactionClient | PrismaService,
        employeeLockHeld: boolean = false,
        lockedEmployee?: { deletedAt: Date | null }
      ) => {
        if (changesLoginIdentifier) {
          const tx = client as Prisma.TransactionClient;
          if (!employeeLockHeld) {
            const locked = await this.sessionsService.lockEmployeeForCredentials(tx, id);
            if (!locked || locked.deletedAt) throw new NotFoundException('用户不存在');
          } else if (lockedEmployee?.deletedAt) {
            throw new NotFoundException('用户不存在');
          }
          await lockAndAssertEmployeeLoginIdentifiersAvailable(
            tx,
            [normalizedUsername, normalizedPhone],
            id
          );
        }
        const updated = await client.employee.update({
          where: {
            id,
            deletedAt: null,
            ...(requestVersion !== undefined ? { version: requestVersion } : {}),
          },
          data,
          include: {
            userRoles: { include: { role: { include: { permissions: true } } } },
          },
        });
        if (changedSecurityFields.length > 0) {
          await this.writeSecurityAudit(
            client as Prisma.TransactionClient,
            currentUser,
            'update',
            id,
            {
              changedFields: changedSecurityFields,
              ...(rest.status !== undefined ? { status: rest.status } : {}),
              ...(roleIds !== undefined ? { roleIds } : {}),
            }
          );
        }
        return updated;
      };
      const actorEmployeeId = currentUser.employeeId ?? currentUser.id;
      const mustRevokeCredentials = passwordChanged || rest.status === 'disabled';
      const revocation = mustRevokeCredentials
        ? await this.sessionsService.revokeAllCredentials(
            id,
            (tx, locked) => updateEmployee(tx, true, locked),
            [actorEmployeeId]
          )
        : null;
      const employee = revocation
        ? revocation.value
        : await this.prisma.$transaction(async (tx) => {
            const lockedEmployees = await this.sessionsService.lockEmployeesForCredentials(tx, [
              id,
              actorEmployeeId,
            ]);
            const locked = lockedEmployees.get(id);
            if (!locked || locked.deletedAt) throw new NotFoundException('用户不存在');
            return updateEmployee(tx, true, locked);
          });

      this.invalidateAuthCache(employee.id);
      if (revocation) {
        this.logger.log(
          `用户 ${id} 凭据已变更，吊销 ${revocation.revokedSessions} 个会话、${revocation.revokedPats} 个 PAT`
        );
      }

      return this.mapEmployeeToUserResponse(employee);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2025'
      ) {
        throw new ConflictException(
          `数据已被其他用户修改，当前版本 ${requestVersion ?? 'unknown'}。请刷新后重试。`
        );
      }
      throw error;
    }
  }

  /**
   * 删除用户（push 6: 关闭登录 + 软删 employee）
   */
  async remove(id: string, currentUser: { id: string; employeeId?: string | null }) {
    assertEmployeeIsNotProtected(id);
    await this.findOne(id);

    try {
      await this.sessionsService.revokeAllCredentials(
        id,
        async (tx) => {
          const updated = await tx.employee.update({
            where: { id, deletedAt: null },
            data: {
              canLogin: false,
              loginStatus: 'disabled',
              deletedAt: new Date(),
              version: { increment: 1 },
              ...auditUpdate(currentUser),
            },
          });
          await this.writeSecurityAudit(tx, currentUser, 'remove', id, { status: 'disabled' });
          return updated;
        },
        [currentUser.employeeId ?? currentUser.id],
        (tx) => lockEmployeeDepartmentWrites(tx, id)
      );
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2025'
      ) {
        throw new ConflictException('用户已被修改或删除，请刷新后重试');
      }
      throw error;
    }

    this.invalidateAuthCache(id);
    return { success: true };
  }

  /**
   * 更新用户状态
   */
  async updateStatus(
    id: string,
    status: 'active' | 'disabled',
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<{ success: boolean }> {
    assertEmployeeIsNotProtected(id);
    await this.findOne(id);

    const updateStatus = async (
      client: Prisma.TransactionClient,
      locked: { deletedAt: Date | null }
    ) => {
      if (locked.deletedAt) throw new NotFoundException('用户不存在');
      const updated = await client.employee.update({
        where: { id, deletedAt: null },
        data: {
          loginStatus: status,
          canLogin: status === 'active',
          ...(status === 'active' ? { loginFailCount: 0, lockUntil: null } : {}),
          ...auditUpdate(currentUser),
          version: { increment: 1 },
        },
      });
      await this.writeSecurityAudit(client as Prisma.TransactionClient, currentUser, 'status', id, {
        status,
      });
      return updated;
    };

    const actorEmployeeId = currentUser.employeeId ?? currentUser.id;
    if (status === 'disabled') {
      const revoked = await this.sessionsService.revokeAllCredentials(id, updateStatus, [
        actorEmployeeId,
      ]);
      this.logger.log(
        `用户 ${id} 已禁用，吊销 ${revoked.revokedSessions} 个会话、${revoked.revokedPats} 个 PAT`
      );
    } else {
      await this.prisma.$transaction(async (tx) => {
        const lockedEmployees = await this.sessionsService.lockEmployeesForCredentials(tx, [
          id,
          actorEmployeeId,
        ]);
        const locked = lockedEmployees.get(id);
        if (!locked) throw new NotFoundException('用户不存在');
        await updateStatus(tx, locked);
      });
    }
    this.invalidateAuthCache(id);

    return { success: true };
  }

  /**
   * 修改密码（push 6: 直接改 employee.password）
   */
  async changePassword(id: string, currentPassword: string, newPassword: string) {
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    const revoked = await this.sessionsService.revokeAllCredentials(id, async (tx, locked) => {
      if (locked.deletedAt) throw new NotFoundException('用户不存在');
      // 在 Employee 行锁内重读并校验当前密码，避免并发改密覆盖。
      const employee = await tx.employee.findUnique({ where: { id, deletedAt: null } });
      if (!employee) throw new NotFoundException('用户不存在');
      if (!employee.password) throw new ConflictException('该账号未开通登录');
      if (!(await bcrypt.compare(currentPassword, employee.password))) {
        throw new ConflictException('当前密码错误');
      }
      const updated = await tx.employee.update({
        where: { id, deletedAt: null },
        data: { password: hashedPassword, version: { increment: 1 } },
      });
      await this.writeSecurityAudit(tx, { id, employeeId: id }, 'password', id, {
        changedFields: ['credential_secret'],
      });
      return updated;
    });

    this.invalidateAuthCache(id);
    this.logger.log(
      `用户 ${id} 修改密码，已吊销 ${revoked.revokedSessions} 个会话、${revoked.revokedPats} 个 PAT`
    );
    return { success: true };
  }

  // 历史 API 占位（push 6 user 表已删除）：保留方法名让外部调用不至于编译失败。
  // 未来若有调用方仍依赖 linkUser/unlinkUser，统一改用 employee.update 设登录字段。
}
