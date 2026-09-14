import { USER_STATUS } from '@ky-azeroth/shared/constants/status-values';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { SerialNumberType } from '../../common/constants/serial-number.constants';
import { FilterApplierService } from '../../common/filter-scheme';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  authCacheKeysFor,
  EmployeePermissionCacheService,
  scopeCacheKeyPrefixFor,
} from '../../common/services/employee-permission-cache.service';
import { SerialNumberService } from '../../common/services/serial-number.service';
import { auditCreate, auditCreateOnly, auditUpdate } from '../../common/utils/audit-helper';
import { toJsonValue } from '../../common/utils/json-type-helpers';
import { calculatePagination, toDateOnlyString } from '../../common/utils/response-helpers';
import { assertEmployeeIsNotProtected } from '../auth/guards/protected-employee';
import { lockEmployeeDepartmentWrites } from '../departments/employee-department-lock';
import { SessionsService } from '../sessions/sessions.service';
import {
  BindEmployeeDingtalkDto,
  CreateEmployeeDto,
  EmployeeResponseDto,
  QueryEmployeesDto,
  UnbindEmployeeDingtalkDto,
  UpdateEmployeeDto,
} from './dto';
import {
  lockAndAssertEmployeeLoginIdentifiersAvailable,
  normalizeEmployeeLoginIdentifier,
} from './employee-login-identifier';
import { EMPLOYEE_FILTER_REGISTRY } from './employees.filter-registry';

interface DingtalkBindingValues {
  dingtalkUserId: string | null;
  dingtalkUnionId: string | null;
}

@Injectable()
export class EmployeesService {
  private readonly logger = new Logger(EmployeesService.name);

  constructor(
    private prisma: PrismaService,
    private serialNumberService: SerialNumberService,
    private readonly filterApplier: FilterApplierService,
    private readonly authCache: EmployeePermissionCacheService,
    private readonly sessionsService: SessionsService = new SessionsService(prisma)
  ) {}

  private invalidateAuthCache(employeeId: string): void {
    this.authCache.invalidateMany(authCacheKeysFor(employeeId));
    // viewScope 缓存按 (employee, module, menu) 三段,按前缀清空
    this.authCache.invalidateByPrefix(scopeCacheKeyPrefixFor(employeeId));
  }

  /**
   * 创建员工
   */
  async create(
    createEmployeeDto: CreateEmployeeDto,
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<EmployeeResponseDto> {
    const serialNumber = await this.serialNumberService.generate(SerialNumberType.EMPLOYEE);
    const normalizedPhone = normalizeEmployeeLoginIdentifier(createEmployeeDto.phone);

    const employeeId = await this.prisma.$transaction(async (tx) => {
      await lockAndAssertEmployeeLoginIdentifiersAvailable(tx, [normalizedPhone]);
      const employee = await tx.employee.create({
        data: {
          name: createEmployeeDto.name,
          phone: normalizedPhone ?? undefined,
          email: createEmployeeDto.email ?? undefined,
          gender: createEmployeeDto.gender ?? undefined,
          entryDate: createEmployeeDto.entryDate
            ? new Date(createEmployeeDto.entryDate)
            : undefined,
          position: createEmployeeDto.position ?? undefined,
          status: createEmployeeDto.status ?? undefined,
          avatar: createEmployeeDto.avatar ?? undefined,
          hourlyRate:
            createEmployeeDto.hourlyRate != null ? String(createEmployeeDto.hourlyRate) : undefined,
          // 2026-05-23：显式禁用登录。新员工默认不能登录，由管理员经
          // users.updateStatus() 同步开通 loginStatus + canLogin。
          // schema 默认值也已改为 disabled，此处显式声明意在明确意图。
          loginStatus: 'disabled',
          canLogin: false,
          serialNumber,
          ...auditCreate(currentUser),
        },
        select: { id: true },
      });

      // 处理部门关联（与主记录写同一事务，校验失败 / createMany 失败 → 整体回滚）
      if (createEmployeeDto.departmentIds && createEmployeeDto.departmentIds.length > 0) {
        await this.syncEmployeeDepartments(
          tx,
          employee.id,
          createEmployeeDto.departmentIds,
          createEmployeeDto.primaryDepartmentId,
          currentUser
        );
      }

      return employee.id;
    });

    // 统一重查返回完整 DTO（部门已是最新）
    return this.findOne(employeeId);
  }

  /**
   * 同步员工部门关联
   */
  private async syncEmployeeDepartments(
    tx: Prisma.TransactionClient,
    employeeId: string,
    departmentIds: string[],
    primaryDepartmentId?: string | null,
    currentUser?: { id: string; employeeId?: string | null },
    employeeDepartmentLockHeld: boolean = false
  ): Promise<void> {
    if (!employeeDepartmentLockHeld) {
      await lockEmployeeDepartmentWrites(tx, employeeId);
    }

    // 先校验（非空时）——任何破坏性写之前完成，校验失败 → 抛异常 → 事务整体回滚，零副作用
    if (departmentIds.length > 0) {
      const departments = await tx.department.findMany({
        where: { id: { in: departmentIds }, deletedAt: null },
        select: { id: true },
      });
      // 用 Set 去重，防止 payload 传重复 id 时 length 比较误判（findMany 去重、入参没去重）
      const validIds = new Set(departments.map((d) => d.id));
      const requestedUnique = new Set(departmentIds);
      if (validIds.size !== requestedUnique.size) {
        throw new BadRequestException('部分部门不存在');
      }
    }

    // 校验通过后才删旧关联
    await tx.employeeDepartment.deleteMany({
      where: { employeeId },
    });

    // 空数组语义：清空后结束
    if (departmentIds.length === 0) return;

    // 确定主部门 + 重建（去重后建，避免唯一约束/重复行）
    const uniqueDeptIds = [...new Set(departmentIds)];
    const primaryId =
      primaryDepartmentId && uniqueDeptIds.includes(primaryDepartmentId)
        ? primaryDepartmentId
        : uniqueDeptIds[0];

    // 创建新关联
    const auditFields = auditCreateOnly(currentUser);
    await tx.employeeDepartment.createMany({
      data: uniqueDeptIds.map((departmentId, index) => ({
        employeeId,
        departmentId,
        isPrimary: departmentId === primaryId,
        sortOrder: index,
        ...auditFields,
      })),
    });
  }

  /**
   * 查询员工列表
   */
  async findAll(query: QueryEmployeesDto, rawQuery?: unknown) {
    const { departmentId } = query;
    const { page = 1, pageSize = 10, sortBy = 'createdAt', sortOrder = 'desc' } = query;
    const { skip, take } = calculatePagination(page, pageSize);

    // 部门筛选走关联表 some 条件，不适合放在 registry（registry 目前只处理扁平字段）。
    // 保留在 service baseWhere 里；新前端若要筛部门，可通过 departmentId query param 原样传递。
    const baseWhere: Prisma.EmployeeWhereInput = { deletedAt: null };
    if (departmentId) {
      baseWhere.departments = { some: { departmentId } };
    }

    const where = await this.filterApplier.buildWhere<Prisma.EmployeeWhereInput>({
      registry: EMPLOYEE_FILTER_REGISTRY,
      rawQuery,
      legacyKeyword: query.keyword,
      legacyFilters: { status: query.status },
      chargerScope: null,
      baseWhere,
    });

    // 动态构建排序对象
    const orderBy: Prisma.EmployeeOrderByWithRelationInput = {};
    if (sortBy) {
      orderBy[sortBy as keyof Prisma.EmployeeOrderByWithRelationInput] = sortOrder;
    }

    const [items, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          departments: {
            include: {
              department: {
                select: { id: true, name: true },
              },
            },
            orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
          },
        },
      }),
      this.prisma.employee.count({ where }),
    ]);

    return {
      items: items.map((item) => this.toResponseDto(item)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 查询所有员工（用于下拉框等场景，不分页）
   *
   * 默认仅返回登录状态为 active 的员工——即可以登录系统的人。
   * 与"在职状态"（status: active/inactive/resigned）解耦：
   *   - 在职但账号未启用（如新员工未开通）→ 不出现
   *   - 离职但账号未禁用（异常状态）→ 仍可能出现，由账号管理员负责清理
   */
  async findAllForSelection(query: {
    keyword?: string;
    loginStatus?: string;
    departmentId?: string;
    roleCodes?: string[];
  }) {
    const { keyword, loginStatus = USER_STATUS.ACTIVE, departmentId, roleCodes } = query;
    const where: Prisma.EmployeeWhereInput = {
      deletedAt: null,
      loginStatus,
    };

    if (keyword) {
      where.OR = [
        { name: { contains: keyword, mode: 'insensitive' } },
        { serialNumber: { contains: keyword, mode: 'insensitive' } },
      ];
    }

    if (departmentId) {
      where.departments = {
        some: { departmentId },
      };
    }

    // roleCodes：按角色 code 过滤（例如工时统计「记录人」只展示 PM/DEVELOPER）。
    // 走 Employee.userRoles → Role.code 的 some 匹配，不传则不过滤。
    if (roleCodes && roleCodes.length > 0) {
      where.userRoles = {
        some: { role: { code: { in: roleCodes } } },
      };
    }

    const employees = await this.prisma.employee.findMany({
      where,
      orderBy: {
        name: 'asc',
      },
      select: {
        id: true,
        name: true,
        serialNumber: true,
      },
    });

    return employees;
  }

  /**
   * 查询员工详情
   */
  async findOne(id: string): Promise<EmployeeResponseDto> {
    const employee = await this.prisma.employee.findFirst({
      where: { id, deletedAt: null },
      include: {
        departments: {
          include: {
            department: {
              select: { id: true, name: true },
            },
          },
          orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
        },
      },
    });

    if (!employee) {
      throw new NotFoundException(`员工 ${id} 不存在`);
    }

    return this.toResponseDto(employee);
  }

  /**
   * 更新员工
   */
  async update(
    id: string,
    updateEmployeeDto: UpdateEmployeeDto,
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<EmployeeResponseDto> {
    assertEmployeeIsNotProtected(id);
    this.logger.log(
      `更新员工 ${id}, departmentIds: ${JSON.stringify(updateEmployeeDto.departmentIds)}, primaryDepartmentId: ${updateEmployeeDto.primaryDepartmentId}`
    );
    // 冲突提示只需版本号；不要在关系锁之外预读 departments。
    const existing = await this.prisma.employee.findFirst({
      where: { id, deletedAt: null },
      select: { version: true },
    });
    if (!existing) {
      throw new NotFoundException(`员工 ${id} 不存在`);
    }

    const { version: requestVersion } = updateEmployeeDto;

    try {
      await this.prisma.$transaction(async (tx) => {
        const rebuildsDepartments = updateEmployeeDto.departmentIds !== undefined;
        const changesPhone = updateEmployeeDto.phone !== undefined;
        const normalizedPhone = changesPhone
          ? normalizeEmployeeLoginIdentifier(updateEmployeeDto.phone)
          : undefined;
        // 部门写入口统一先取关系 advisory，再按 ID 排序预锁目标与审计操作者 Employee 行。
        if (rebuildsDepartments) await lockEmployeeDepartmentWrites(tx, id);
        const lockedEmployees = await this.sessionsService.lockEmployeesForCredentials(tx, [
          id,
          currentUser.employeeId ?? currentUser.id,
        ]);
        const locked = lockedEmployees.get(id);
        if (!locked || locked.deletedAt) {
          throw new NotFoundException(`员工 ${id} 不存在`);
        }
        if (changesPhone) {
          await lockAndAssertEmployeeLoginIdentifiersAvailable(tx, [normalizedPhone], id);
        }

        // 主记录写：乐观锁 CAS + version++
        await tx.employee.update({
          where: {
            id,
            deletedAt: null,
            ...(requestVersion !== undefined ? { version: requestVersion } : {}),
          },
          data: {
            name: updateEmployeeDto.name,
            phone: normalizedPhone,
            email: updateEmployeeDto.email ?? undefined,
            gender: updateEmployeeDto.gender ?? undefined,
            entryDate: updateEmployeeDto.entryDate
              ? new Date(updateEmployeeDto.entryDate)
              : undefined,
            position: updateEmployeeDto.position ?? undefined,
            status: updateEmployeeDto.status ?? undefined,
            avatar: updateEmployeeDto.avatar ?? undefined,
            ...(updateEmployeeDto.hourlyRate !== undefined
              ? {
                  hourlyRate:
                    updateEmployeeDto.hourlyRate != null
                      ? String(updateEmployeeDto.hourlyRate)
                      : null,
                }
              : {}),
            ...auditUpdate(currentUser),
            version: { increment: 1 },
          },
        });

        // 部门同步：与主记录写同一事务。校验失败 / createMany 失败 → 整体回滚
        if (rebuildsDepartments) {
          await this.syncEmployeeDepartments(
            tx,
            id,
            updateEmployeeDto.departmentIds ?? [],
            updateEmployeeDto.primaryDepartmentId,
            currentUser,
            true
          );
        }
      });

      // 缓存失效放事务成功之后（事务回滚则不应失效缓存）
      this.invalidateAuthCache(id);

      // 统一重查返回（部门已是最新；事务已提交，无脏读）
      return this.findOne(id);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2025'
      ) {
        throw new ConflictException(
          `数据已被其他用户修改，当前版本 ${existing.version}。请刷新后重试。`
        );
      }
      throw error;
    }
  }

  /** 管理员 以显式旧 pair CAS 完整替换员工钉钉身份，并原子吊销认证凭证。 */
  async bindDingtalk(
    id: string,
    body: BindEmployeeDingtalkDto,
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<EmployeeResponseDto> {
    return this.replaceDingtalkBinding(
      id,
      body.version,
      {
        dingtalkUserId: body.expectedDingtalkUserId,
        dingtalkUnionId: body.expectedDingtalkUnionId,
      },
      {
        dingtalkUserId: body.dingtalkUserId,
        dingtalkUnionId: body.dingtalkUnionId,
      },
      true,
      currentUser
    );
  }

  /** 管理员 以显式旧 pair CAS 清空员工钉钉身份，并原子吊销认证凭证。 */
  async unbindDingtalk(
    id: string,
    body: UnbindEmployeeDingtalkDto,
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<EmployeeResponseDto> {
    return this.replaceDingtalkBinding(
      id,
      body.version,
      {
        dingtalkUserId: body.expectedDingtalkUserId,
        dingtalkUnionId: body.expectedDingtalkUnionId,
      },
      { dingtalkUserId: null, dingtalkUnionId: null },
      false,
      currentUser
    );
  }

  private async replaceDingtalkBinding(
    id: string,
    version: number,
    expectedBinding: DingtalkBindingValues,
    nextBinding: DingtalkBindingValues,
    dingtalkActive: boolean,
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<EmployeeResponseDto> {
    const normalizedExpected = this.normalizeDingtalkBinding(expectedBinding);
    const normalizedNext = this.normalizeDingtalkBinding(nextBinding);
    if (dingtalkActive && (!normalizedNext.dingtalkUserId || !normalizedNext.dingtalkUnionId)) {
      throw new BadRequestException('绑定钉钉身份必须提供完整的 userId + unionId pair');
    }
    try {
      const employee = await this.prisma.$transaction(async (tx) => {
        await this.lockDingtalkBindingIdentities(tx, id, [normalizedExpected, normalizedNext]);
        const lockedEmployees = await this.sessionsService.lockEmployeesForCredentials(tx, [
          id,
          currentUser.employeeId ?? currentUser.id,
        ]);
        const locked = lockedEmployees.get(id);
        if (!locked || locked.deletedAt) {
          throw new ConflictException('员工已被删除，钉钉身份绑定未完成');
        }
        await this.assertDingtalkBindingAvailable(tx, id, normalizedNext);
        const revoked = await this.sessionsService.revokeAllCredentialsInTransaction(
          tx,
          id,
          locked.tokenInvalidAfter
        );

        const updated = await tx.employee.updateMany({
          where: {
            id,
            version,
            deletedAt: null,
            dingtalkUserId: normalizedExpected.dingtalkUserId,
            dingtalkUnionId: normalizedExpected.dingtalkUnionId,
          },
          data: {
            ...normalizedNext,
            dingtalkActive,
            tokenInvalidAfter: revoked.tokenInvalidAfter,
            ...auditUpdate(currentUser),
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) {
          throw await this.createDingtalkBindingCasConflict(tx, id);
        }

        await tx.operationLog.create({
          data: {
            employeeId: currentUser.employeeId ?? currentUser.id,
            module: 'security',
            action: dingtalkActive ? 'bind' : 'unbind',
            target: id,
            details: toJsonValue({
              oldPair: normalizedExpected,
              newPair: normalizedNext,
              version: { from: version, to: version + 1 },
            }),
          },
        });

        const responseEmployee = await tx.employee.findFirst({
          where: { id, deletedAt: null },
          include: {
            departments: {
              include: {
                department: {
                  select: { id: true, name: true },
                },
              },
              orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
            },
          },
        });
        if (!responseEmployee) {
          throw new ConflictException('员工已被删除，钉钉身份绑定未完成');
        }
        return responseEmployee;
      });

      this.invalidateAuthCache(id);
      return this.toResponseDto(employee);
    } catch (error) {
      const errorCode =
        typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
      if (errorCode === 'P2002') {
        throw new ConflictException('钉钉身份 pair 已被其他员工占用，请核对后重试');
      }
      if (errorCode === 'P2025') {
        throw new ConflictException('员工不存在、已删除或身份快照已过期，请刷新后重试');
      }
      throw error;
    }
  }

  private normalizeDingtalkBinding(binding: DingtalkBindingValues): DingtalkBindingValues {
    return {
      dingtalkUserId: binding.dingtalkUserId?.trim() || null,
      dingtalkUnionId: binding.dingtalkUnionId?.trim() || null,
    };
  }

  private async lockDingtalkBindingIdentities(
    tx: Prisma.TransactionClient,
    employeeId: string,
    bindings: readonly DingtalkBindingValues[]
  ): Promise<void> {
    const lockKeys = new Set<string>([`employee_dingtalk:employee:${employeeId}`]);
    for (const binding of bindings) {
      if (binding.dingtalkUserId) {
        lockKeys.add(`employee_dingtalk:user:${binding.dingtalkUserId}`);
      }
      if (binding.dingtalkUnionId) {
        lockKeys.add(`employee_dingtalk:union:${binding.dingtalkUnionId}`);
      }
    }

    // employeeId 与全部新旧规范化 identity key 固定排序，避免交叉换绑死锁。
    for (const lockKey of [...lockKeys].sort()) {
      // @prisma-raw-sql: Prisma 无法表达事务级 advisory lock；与 SSO 共用身份键命名和排序契约。
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
    }
  }

  private async assertDingtalkBindingAvailable(
    tx: Prisma.TransactionClient,
    id: string,
    binding: DingtalkBindingValues
  ): Promise<void> {
    const identityClauses: Prisma.EmployeeWhereInput[] = [];
    if (binding.dingtalkUserId) {
      identityClauses.push({ dingtalkUserId: binding.dingtalkUserId });
    }
    if (binding.dingtalkUnionId) {
      identityClauses.push({ dingtalkUnionId: binding.dingtalkUnionId });
    }
    if (identityClauses.length === 0) return;

    // 不过滤 deletedAt/dingtalkActive：软删、停用记录仍全局占用历史身份，禁止静默接管。
    const owners = await tx.employee.findMany({
      where: {
        id: { not: id },
        OR: identityClauses,
      },
      select: {
        id: true,
        name: true,
        deletedAt: true,
        dingtalkActive: true,
        dingtalkUserId: true,
        dingtalkUnionId: true,
      },
    });

    const userIdOwner = owners.find((owner) => owner.dingtalkUserId === binding.dingtalkUserId);
    if (userIdOwner) {
      throw new ConflictException(
        `钉钉用户ID已被员工 ${userIdOwner.name}（${userIdOwner.id}）占用`
      );
    }

    const unionIdOwner = owners.find((owner) => owner.dingtalkUnionId === binding.dingtalkUnionId);
    if (unionIdOwner) {
      throw new ConflictException(
        `钉钉UnionId已被员工 ${unionIdOwner.name}（${unionIdOwner.id}）占用`
      );
    }
  }

  private async createDingtalkBindingCasConflict(
    tx: Prisma.TransactionClient,
    id: string
  ): Promise<ConflictException> {
    const latest = await tx.employee.findUnique({
      where: { id },
      select: { version: true, deletedAt: true },
    });
    if (!latest || latest.deletedAt) {
      return new ConflictException('员工不存在或已删除，钉钉身份绑定未变更');
    }
    return new ConflictException(
      `员工钉钉身份或版本已被并发修改，当前版本 ${latest.version}，请刷新后重试`
    );
  }

  /**
   * 删除员工 (软删除)
   * push 6: 不再有 user 表关联校验；如需禁用登录，可同时清空 canLogin
   */
  async remove(id: string, currentUser: { id: string; employeeId?: string | null }) {
    assertEmployeeIsNotProtected(id);

    const revoked = await this.sessionsService.revokeAllCredentials(
      id,
      async (tx) => {
        const existing = await tx.employee.findFirst({
          where: { id, deletedAt: null },
        });
        if (!existing) {
          throw new NotFoundException(`员工 ${id} 不存在`);
        }

        const deletedAt = new Date();
        const updated = await tx.employee.update({
          where: { id, deletedAt: null },
          data: {
            deletedAt,
            canLogin: false,
            loginStatus: 'disabled',
            ...auditUpdate(currentUser),
            version: { increment: 1 },
          },
        });
        await tx.operationLog.create({
          data: {
            employeeId: currentUser.employeeId ?? currentUser.id,
            module: 'security',
            action: 'remove',
            target: id,
            details: toJsonValue({
              status: 'disabled',
              deletedAt: deletedAt.toISOString(),
              version: { from: existing.version, to: existing.version + 1 },
            }),
          },
        });
        return updated;
      },
      [currentUser.employeeId ?? currentUser.id],
      (tx) => lockEmployeeDepartmentWrites(tx, id)
    );

    this.invalidateAuthCache(id);
    this.logger.log(
      `员工 ${id} 已删除，吊销 ${revoked.revokedSessions} 个会话、${revoked.revokedPats} 个 PAT`
    );
    return { message: '删除成功' };
  }

  private toResponseDto(
    employee: Prisma.EmployeeGetPayload<object> & {
      departments?: (Prisma.EmployeeDepartmentGetPayload<object> & {
        department: Pick<Prisma.DepartmentGetPayload<object>, 'id' | 'name'>;
      })[];
    }
  ): EmployeeResponseDto {
    // 转换部门信息
    const departments = employee.departments?.map((ed) => ({
      id: ed.id,
      departmentId: ed.departmentId,
      departmentName: ed.department.name,
      isPrimary: ed.isPrimary,
    }));

    const primaryDepartment = departments?.find((d) => d.isPrimary) || departments?.[0] || null;

    return {
      id: employee.id,
      name: employee.name,
      serialNumber: employee.serialNumber,
      phone: employee.phone,
      email: employee.email ?? undefined,
      gender: employee.gender ?? undefined,
      position: employee.position ?? undefined,
      hourlyRate: employee.hourlyRate != null ? Number(employee.hourlyRate) : undefined,
      status: employee.status,
      entryDate: toDateOnlyString(employee.entryDate) ?? undefined,
      avatar: employee.avatar ?? undefined,
      username: employee.username ?? undefined,
      loginStatus: employee.loginStatus,
      canLogin: employee.canLogin,
      lastLoginAt: employee.lastLoginAt ? employee.lastLoginAt.toISOString() : undefined,
      lastLoginIp: employee.lastLoginIp ?? undefined,
      loginFailCount: employee.loginFailCount,
      lockUntil: employee.lockUntil ? employee.lockUntil.toISOString() : undefined,
      tokenInvalidAfter: employee.tokenInvalidAfter
        ? employee.tokenInvalidAfter.toISOString()
        : undefined,
      jobNumber: employee.jobNumber ?? undefined,
      workPlace: employee.workPlace ?? undefined,
      isAdmin: employee.isAdmin,
      isBoss: employee.isBoss,
      isLeader: employee.isLeader,
      dingtalkUserId: employee.dingtalkUserId ?? undefined,
      dingtalkUnionId: employee.dingtalkUnionId ?? undefined,
      dingtalkActive: employee.dingtalkActive,
      dingtalkExtension: employee.dingtalkExtension as Record<string, unknown> | null | undefined,
      lastSyncAt: employee.lastSyncAt ? employee.lastSyncAt.toISOString() : undefined,
      createdAt: employee.createdAt.toISOString(),
      createdBy: employee.creatorEmployeeId ?? undefined,
      updatedAt: employee.updatedAt.toISOString(),
      updatedBy: employee.updaterEmployeeId ?? undefined,
      deletedAt: employee.deletedAt ? employee.deletedAt.toISOString() : undefined,
      version: employee.version,
      departments,
      primaryDepartment,
    };
  }
}
