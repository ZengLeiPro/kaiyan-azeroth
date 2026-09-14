import type { RoleResponseOutput } from '@ky-azeroth/shared/schemas';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { FilterApplierService } from '../../common/filter-scheme';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  authCacheKeysFor,
  EmployeePermissionCacheService,
  scopeCacheKeyPrefixFor,
} from '../../common/services/employee-permission-cache.service';
import { auditCreate, auditUpdate } from '../../common/utils/audit-helper';
import { calculatePagination, serializeEntity } from '../../common/utils/response-helpers';
import {
  assertEmployeeIsNotProtected,
  getProtectedEmployeeId,
} from '../auth/guards/protected-employee';
import {
  assertPermissionsWithinActorScope,
  mergePermissionSlices,
  type PermissionSlice,
} from '../auth/permission-scope';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { ROLE_FILTER_REGISTRY } from './roles.filter-registry';

const EFFECTIVE_ROLE_USER_WHERE: Prisma.UserRoleWhereInput = {
  employee: {
    deletedAt: null,
    loginStatus: 'active',
    canLogin: true,
  },
};

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly filterApplier: FilterApplierService,
    private readonly authCache: EmployeePermissionCacheService
  ) {}

  /**
   * 失效该 role 下所有 employee 的 auth 链路缓存。
   * 权限变更后立即生效,不依赖 5min TTL 自然过期。
   */
  private async invalidateAuthCacheForRole(
    roleId: string,
    extraEmployeeIds: string[] = []
  ): Promise<void> {
    const userRoles = await this.prisma.userRole.findMany({
      where: { roleId },
      select: { employeeId: true },
    });
    const keys: string[] = [];
    const employeeIds = new Set<string>(extraEmployeeIds);
    for (const ur of userRoles ?? []) {
      employeeIds.add(ur.employeeId);
    }
    for (const employeeId of employeeIds) {
      keys.push(...authCacheKeysFor(employeeId));
    }
    this.authCache.invalidateMany(keys);

    // viewScope 缓存按 (employee, module, menu) 三段,按前缀清空
    for (const employeeId of employeeIds) {
      this.authCache.invalidateByPrefix(scopeCacheKeyPrefixFor(employeeId));
    }
  }

  private async assertRoleMutationAllowed(
    currentUser: { id: string; employeeId?: string | null },
    permissions: PermissionSlice[] | undefined,
    userIds: string[] | undefined,
    currentlyAssignedEmployeeIds: string[] = []
  ): Promise<void> {
    const actorEmployeeId = currentUser.employeeId ?? currentUser.id;
    const actor = await this.prisma.employee.findUnique({
      where: { id: actorEmployeeId, deletedAt: null },
      select: {
        userRoles: {
          where: { role: { deletedAt: null, status: 'active' } },
          select: { role: { select: { permissions: true } } },
        },
      },
    });
    if (!actor) {
      throw new ForbiddenException('当前账号无效，不能变更角色');
    }
    if (permissions) {
      assertPermissionsWithinActorScope(
        permissions,
        mergePermissionSlices(actor.userRoles.flatMap((assignment) => assignment.role.permissions))
      );
    }
    if (!userIds) return;

    const protectedEmployeeId = getProtectedEmployeeId();
    if (!protectedEmployeeId) return;
    const currentlyAssigned = currentlyAssignedEmployeeIds.includes(protectedEmployeeId);
    const requestedAssigned = userIds.includes(protectedEmployeeId);
    if (currentlyAssigned !== requestedAssigned) {
      assertEmployeeIsNotProtected(protectedEmployeeId);
    }
  }

  private serializeRole(role: { users?: { employeeId: string }[] }): RoleResponseOutput {
    const serialized = serializeEntity<RoleResponseOutput>(role);
    return {
      ...serialized,
      userIds: role.users?.map((userRole) => userRole.employeeId) ?? [],
    };
  }

  /**
   * 创建角色
   */
  async create(
    createRoleDto: CreateRoleDto,
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<RoleResponseOutput> {
    const { code, permissions, userIds, ...rest } = createRoleDto;
    await this.assertRoleMutationAllowed(currentUser, permissions, userIds);

    // 检查角色编码是否已存在
    const existingRole = await this.prisma.role.findUnique({
      where: { code },
    });

    if (existingRole) {
      throw new ConflictException('角色编码已存在');
    }

    const role = await this.prisma.role.create({
      data: {
        code,
        ...rest,
        ...auditCreate(currentUser),
        permissions: {
          create: permissions,
        },
        ...(userIds && {
          users: {
            create: userIds.map((employeeId) => ({ employeeId })),
          },
        }),
      },
      include: {
        permissions: true,
        users: {
          where: EFFECTIVE_ROLE_USER_WHERE,
          select: { employeeId: true },
        },
      },
    });
    return this.serializeRole(role);
  }

  /**
   * 查询角色列表
   */
  async findAll(
    query: { page?: number; pageSize?: number; keyword?: string; status?: string },
    rawQuery?: unknown
  ) {
    const { page = 1, pageSize = 20 } = query;
    const { skip } = calculatePagination(page, pageSize);

    const where = await this.filterApplier.buildWhere<Prisma.RoleWhereInput>({
      registry: ROLE_FILTER_REGISTRY,
      rawQuery,
      legacyKeyword: query.keyword,
      legacyFilters: { status: query.status },
      chargerScope: null,
      baseWhere: { deletedAt: null },
    });

    const [total, roles] = await Promise.all([
      this.prisma.role.count({ where }),
      this.prisma.role.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          permissions: true,
          users: {
            where: EFFECTIVE_ROLE_USER_WHERE,
            select: { employeeId: true },
          },
        },
      }),
    ]);

    return {
      items: roles.map((role) => {
        return { ...this.serializeRole(role), userCount: role.users?.length ?? 0 };
      }),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 根据ID查询角色
   */
  async findOne(id: string): Promise<RoleResponseOutput> {
    const role = await this.prisma.role.findFirst({
      where: { id, deletedAt: null },
      include: {
        permissions: true,
        users: {
          where: EFFECTIVE_ROLE_USER_WHERE,
          select: { employeeId: true },
        },
      },
    });

    if (!role) {
      throw new NotFoundException('角色不存在');
    }

    return this.serializeRole(role);
  }

  /**
   * 更新角色
   */
  async update(
    id: string,
    updateRoleDto: UpdateRoleDto,
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<RoleResponseOutput> {
    const { permissions, userIds, version: requestVersion, ...rest } = updateRoleDto;

    // 检查角色是否存在，并记录更新前关联人员用于清理被移除人员缓存
    const beforeUserRoles = await this.prisma.userRole.findMany({
      where: { roleId: id },
      select: { employeeId: true },
    });
    await this.assertRoleMutationAllowed(
      currentUser,
      permissions,
      userIds,
      beforeUserRoles.map((userRole) => userRole.employeeId)
    );
    await this.findOne(id);

    // 检查角色编码是否已被其他角色使用
    if (rest.code) {
      const existingRole = await this.prisma.role.findFirst({
        where: {
          code: rest.code,
          id: { not: id },
          deletedAt: null,
        },
      });

      if (existingRole) {
        throw new ConflictException('角色编码已存在');
      }
    }

    try {
      const role = await this.prisma.role.update({
        where: {
          id,
          ...(requestVersion !== undefined ? { version: requestVersion } : {}),
        },
        data: {
          ...rest,
          ...auditUpdate(currentUser),
          version: { increment: 1 },
          ...(permissions && {
            permissions: {
              deleteMany: {},
              create: permissions,
            },
          }),
          ...(userIds && {
            users: {
              deleteMany: {},
              create: userIds.map((employeeId) => ({ employeeId })),
            },
          }),
        },
        include: {
          permissions: true,
          users: {
            where: EFFECTIVE_ROLE_USER_WHERE,
            select: { employeeId: true },
          },
        },
      });

      await this.invalidateAuthCacheForRole(
        id,
        beforeUserRoles.map((userRole) => userRole.employeeId)
      );
      return this.serializeRole(role);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException(
          `数据已被其他用户修改，当前版本 ${requestVersion ?? 'unknown'}。请刷新后重试。`
        );
      }
      throw error;
    }
  }

  /**
   * 删除角色（软删除）
   */
  async remove(id: string, currentUser: { id: string; employeeId?: string | null }) {
    // 检查角色是否存在
    await this.findOne(id);

    // 检查是否有用户关联此角色
    const userCount = await this.prisma.userRole.count({
      where: { roleId: id },
    });

    if (userCount > 0) {
      throw new ConflictException(`该角色下有 ${userCount} 个用户，无法删除`);
    }

    await this.prisma.role.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        ...auditUpdate(currentUser),
      },
    });

    await this.invalidateAuthCacheForRole(id);
    return { success: true };
  }
}
