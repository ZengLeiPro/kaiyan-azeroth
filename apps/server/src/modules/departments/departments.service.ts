import type { DepartmentResponseOutput } from '@ky-azeroth/shared/schemas';
import { IDepartmentTreeNode } from '@ky-azeroth/shared/types';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { FilterApplierService } from '../../common/filter-scheme';
import type { PaginatedResponse } from '../../common/interfaces/pagination.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import { auditCreate, auditCreateOnly, auditUpdate } from '../../common/utils/audit-helper';
import { calculatePagination, serializeEntity } from '../../common/utils/response-helpers';
import { DEPARTMENT_FILTER_REGISTRY } from './departments.filter-registry';
import {
  CreateDepartmentDto,
  QueryDepartmentDto,
  SetDepartmentManagersDto,
  UpdateDepartmentDto,
} from './dto';
import { lockEmployeeDepartmentWrites } from './employee-department-lock';

type DepartmentWithRelations = Prisma.DepartmentGetPayload<object> & {
  parent?: Prisma.DepartmentGetPayload<object> | null;
  children?: Prisma.DepartmentGetPayload<object>[];
  manager?: Prisma.EmployeeGetPayload<object> | null;
  _count?: {
    employees?: number;
    children?: number;
  };
};

@Injectable()
export class DepartmentsService {
  constructor(
    private prisma: PrismaService,
    private readonly filterApplier: FilterApplierService
  ) {}

  /**
   * 创建部门
   */
  async create(
    createDepartmentDto: CreateDepartmentDto,
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<DepartmentResponseOutput> {
    // 验证父部门
    if (createDepartmentDto.parentId) {
      const parent = await this.prisma.department.findFirst({
        where: { id: createDepartmentDto.parentId, deletedAt: null },
      });
      if (!parent) {
        throw new BadRequestException(`父部门 ${createDepartmentDto.parentId} 不存在`);
      }
    }

    // 验证负责人
    if (createDepartmentDto.managerId) {
      const manager = await this.prisma.employee.findFirst({
        where: { id: createDepartmentDto.managerId, deletedAt: null },
      });
      if (!manager) {
        throw new BadRequestException(`负责人 ${createDepartmentDto.managerId} 不存在`);
      }
    }

    // 创建部门
    const department = await this.prisma.department.create({
      data: {
        name: createDepartmentDto.name,
        parentId: createDepartmentDto.parentId ?? null,
        sortOrder: createDepartmentDto.sortOrder ?? 0,
        managerId: createDepartmentDto.managerId ?? null,
        status: createDepartmentDto.status ?? 'active',
        ...auditCreate(currentUser),
      },
      include: {
        parent: true,
        manager: true,
        _count: {
          select: {
            employees: true,
            children: true,
          },
        },
      },
    });

    return this.toResponseDto(department);
  }

  /**
   * 获取部门树
   */
  async getTree(): Promise<IDepartmentTreeNode[]> {
    const departments = await this.prisma.department.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        manager: true,
        _count: {
          select: {
            employees: true,
          },
        },
      },
    });

    return this.buildTree(departments);
  }

  /**
   * 构建树形结构
   */
  private buildTree(departments: DepartmentWithRelations[]): IDepartmentTreeNode[] {
    const map = new Map<string, IDepartmentTreeNode>();
    const roots: IDepartmentTreeNode[] = [];

    // 第一遍：创建所有节点
    for (const dept of departments) {
      const node: IDepartmentTreeNode = {
        id: dept.id,
        name: dept.name,
        parentId: dept.parentId,
        sortOrder: dept.sortOrder,
        status: dept.status as 'active' | 'inactive',
        managerId: dept.managerId,
        dingtalkDeptId: dept.dingtalkDeptId ?? undefined,
        dingtalkParentId: dept.dingtalkParentId ?? undefined,
        createDeptGroup: dept.createDeptGroup,
        autoAddUser: dept.autoAddUser,
        lastSyncAt: dept.lastSyncAt ? dept.lastSyncAt.toISOString() : undefined,
        manager: dept.manager ? { id: dept.manager.id, name: dept.manager.name } : null,
        children: [],
        employeeCount: dept._count?.employees ?? 0,
        createdAt: dept.createdAt.toISOString(),
        updatedAt: dept.updatedAt.toISOString(),
      };
      map.set(dept.id, node);
    }

    // 第二遍：构建父子关系
    for (const dept of departments) {
      const node = map.get(dept.id)!;
      if (dept.parentId && map.has(dept.parentId)) {
        map.get(dept.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  /**
   * 查询所有部门（用于选择器，不分页）
   */
  async findAllForSelection(keyword?: string, status?: string) {
    const where: Prisma.DepartmentWhereInput = {
      deletedAt: null,
      status: status ?? 'active',
    };

    if (keyword) {
      where.name = { contains: keyword, mode: 'insensitive' };
    }

    const departments = await this.prisma.department.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        parentId: true,
      },
      take: 100,
    });

    return departments;
  }

  /**
   * 分页查询部门列表
   */
  async findAll(
    query: QueryDepartmentDto,
    rawQuery?: unknown
  ): Promise<PaginatedResponse<DepartmentResponseOutput>> {
    const { parentId } = query;
    const { page = 1, pageSize = 10, sortBy = 'createdAt', sortOrder = 'desc' } = query;
    const { skip, take } = calculatePagination(page, pageSize);

    // parentId 可以是 null（查顶级部门），registry 里的 parentId 只支持 in 过滤，
    // 无法表达"等于 null"。把 parentId 作为 service baseWhere 硬规则保留。
    const baseWhere: Prisma.DepartmentWhereInput = { deletedAt: null };
    if (parentId !== undefined) {
      baseWhere.parentId = parentId;
    }

    const where = await this.filterApplier.buildWhere<Prisma.DepartmentWhereInput>({
      registry: DEPARTMENT_FILTER_REGISTRY,
      rawQuery,
      legacyKeyword: query.keyword,
      legacyFilters: { status: query.status },
      chargerScope: null,
      baseWhere,
    });

    // 动态构建排序对象
    const orderBy: Prisma.DepartmentOrderByWithRelationInput = {};
    if (sortBy) {
      orderBy[sortBy as keyof Prisma.DepartmentOrderByWithRelationInput] = sortOrder;
    }

    const [items, total] = await Promise.all([
      this.prisma.department.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          parent: true,
          manager: true,
          _count: {
            select: {
              employees: true,
              children: true,
            },
          },
        },
      }),
      this.prisma.department.count({ where }),
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
   * 获取部门详情
   */
  async findOne(id: string): Promise<DepartmentResponseOutput> {
    const department = await this.prisma.department.findFirst({
      where: { id, deletedAt: null },
      include: {
        parent: true,
        manager: true,
        _count: {
          select: {
            employees: true,
            children: true,
          },
        },
      },
    });

    if (!department) {
      throw new NotFoundException(`部门 ${id} 不存在`);
    }

    return this.toResponseDto(department);
  }

  /**
   * 获取直接子部门
   */
  async findChildren(id: string): Promise<DepartmentResponseOutput[]> {
    // 验证父部门存在
    await this.findOne(id);

    const children = await this.prisma.department.findMany({
      where: { parentId: id, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        parent: true,
        manager: true,
        _count: {
          select: {
            employees: true,
            children: true,
          },
        },
      },
    });

    return children.map((child) => this.toResponseDto(child));
  }

  /**
   * 获取部门员工列表（分页）
   */
  async findEmployees(id: string, page: number = 1, pageSize: number = 10) {
    // 验证部门存在
    await this.findOne(id);

    const { skip, take } = calculatePagination(page, pageSize);

    const [employeeDepartments, total] = await Promise.all([
      this.prisma.employeeDepartment.findMany({
        where: { departmentId: id, employee: { deletedAt: null } },
        include: {
          employee: true,
        },
        orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
        skip,
        take,
      }),
      this.prisma.employeeDepartment.count({
        where: { departmentId: id, employee: { deletedAt: null } },
      }),
    ]);

    return {
      items: employeeDepartments.map((ed) => ({
        id: ed.employee.id,
        name: ed.employee.name,
        serialNumber: ed.employee.serialNumber,
        phone: ed.employee.phone,
        position: ed.employee.position,
        status: ed.employee.status,
        isPrimary: ed.isPrimary,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 更新部门
   */
  async update(
    id: string,
    updateDepartmentDto: UpdateDepartmentDto,
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<DepartmentResponseOutput> {
    const existing = await this.findOne(id);

    // 验证 parentId
    if (updateDepartmentDto.parentId !== undefined && updateDepartmentDto.parentId !== null) {
      // 检查是否将部门设为自己的子部门（循环检测）
      if (updateDepartmentDto.parentId === id) {
        throw new BadRequestException('不能将部门设为自己的子部门');
      }

      // 检查是否将部门设为自己后代的子部门
      const isDescendant = await this.isDescendant(updateDepartmentDto.parentId, id);
      if (isDescendant) {
        throw new BadRequestException('不能将部门设为自己后代的子部门');
      }

      const parent = await this.prisma.department.findFirst({
        where: { id: updateDepartmentDto.parentId, deletedAt: null },
      });
      if (!parent) {
        throw new BadRequestException(`父部门 ${updateDepartmentDto.parentId} 不存在`);
      }
    }

    // 验证负责人
    if (updateDepartmentDto.managerId) {
      const manager = await this.prisma.employee.findFirst({
        where: { id: updateDepartmentDto.managerId, deletedAt: null },
      });
      if (!manager) {
        throw new BadRequestException(`负责人 ${updateDepartmentDto.managerId} 不存在`);
      }
    }

    try {
      const department = await this.prisma.department.update({
        where: {
          id,
          ...(updateDepartmentDto.version !== undefined
            ? { version: updateDepartmentDto.version }
            : {}),
        },
        data: {
          name: updateDepartmentDto.name,
          parentId: updateDepartmentDto.parentId,
          sortOrder: updateDepartmentDto.sortOrder ?? undefined,
          managerId: updateDepartmentDto.managerId,
          status: updateDepartmentDto.status ?? undefined,
          ...auditUpdate(currentUser),
          version: { increment: 1 },
        },
        include: {
          parent: true,
          manager: true,
          _count: {
            select: {
              employees: true,
              children: true,
            },
          },
        },
      });

      return this.toResponseDto(department);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException(
          `数据已被其他用户修改，当前版本 ${existing.version}。请刷新后重试。`
        );
      }
      throw error;
    }
  }

  /**
   * 检查目标是否是源的后代
   */
  private async isDescendant(targetId: string, sourceId: string): Promise<boolean> {
    const children = await this.prisma.department.findMany({
      where: { parentId: sourceId, deletedAt: null },
      select: { id: true },
    });

    for (const child of children) {
      if (child.id === targetId) {
        return true;
      }
      const isDesc = await this.isDescendant(targetId, child.id);
      if (isDesc) {
        return true;
      }
    }

    return false;
  }

  /**
   * 删除部门（软删除）
   */
  async remove(id: string, currentUser: { id: string; employeeId?: string | null }) {
    const existing = await this.prisma.department.findFirst({
      where: { id, deletedAt: null },
      include: {
        _count: {
          select: {
            children: true,
            employees: true,
          },
        },
      },
    });

    if (!existing) {
      throw new NotFoundException(`部门 ${id} 不存在`);
    }

    // 检查是否有子部门
    if (existing._count.children > 0) {
      throw new BadRequestException('该部门下存在子部门，无法删除');
    }

    // 检查是否有员工
    if (existing._count.employees > 0) {
      throw new BadRequestException('该部门下存在员工，无法删除');
    }

    // 软删除
    await this.prisma.department.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        ...auditUpdate(currentUser),
      },
    });

    return { message: '删除成功' };
  }

  /**
   * 设置部门负责人
   */
  async setManagers(
    id: string,
    dto: SetDepartmentManagersDto,
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<DepartmentResponseOutput> {
    // 验证部门存在
    const existing = await this.findOne(id);

    // 验证负责人存在（如果设置了 managerId）
    if (dto.managerId) {
      const employee = await this.prisma.employee.findFirst({
        where: { id: dto.managerId, deletedAt: null },
        select: { id: true },
      });
      if (!employee) {
        throw new BadRequestException('负责人员工不存在');
      }
    }

    try {
      // 更新部门的 managerId（带乐观锁）
      const department = await this.prisma.department.update({
        where: {
          id,
          ...(dto.version !== undefined ? { version: dto.version } : {}),
        },
        data: {
          managerId: dto.managerId ?? null,
          ...auditUpdate(currentUser),
          version: { increment: 1 },
        },
        include: {
          parent: true,
          manager: true,
          _count: {
            select: {
              employees: true,
              children: true,
            },
          },
        },
      });

      return this.toResponseDto(department);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException(
          `数据已被其他用户修改，当前版本 ${existing.version}。请刷新后重试。`
        );
      }
      throw error;
    }
  }

  /**
   * 添加员工到部门
   */
  async addEmployee(
    departmentId: string,
    employeeId: string,
    isPrimary: boolean = false,
    currentUser?: { id: string; employeeId?: string | null }
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockEmployeeDepartmentWrites(tx, employeeId);

        // 存在性检查也放在事务内，避免校验后到写入前对象状态发生变化。
        const department = await tx.department.findFirst({
          where: { id: departmentId, deletedAt: null },
          select: { id: true },
        });
        if (!department) {
          throw new NotFoundException(`部门 ${departmentId} 不存在`);
        }

        const employee = await tx.employee.findFirst({
          where: { id: employeeId, deletedAt: null },
          select: { id: true },
        });
        if (!employee) {
          throw new BadRequestException(`员工 ${employeeId} 不存在`);
        }

        // 保持既有 API 语义：已存在的关联仍报重复，不借 add 接口隐式“转主”。
        const existing = await tx.employeeDepartment.findFirst({
          where: { departmentId, employeeId },
          select: { id: true },
        });
        if (existing) {
          throw new BadRequestException('该员工已在此部门中');
        }

        const currentPrimary = await tx.employeeDepartment.findFirst({
          where: { employeeId, isPrimary: true },
          select: { id: true },
        });
        // 首条关系必须成为主部门；若遇到存量 0 主关系，本次新增也恢复“有关系即有主”的不变量。
        const createsPrimary = isPrimary || currentPrimary === null;

        if (isPrimary && currentPrimary) {
          await tx.employeeDepartment.updateMany({
            where: { employeeId, isPrimary: true },
            data: { isPrimary: false },
          });
        }

        const maxSortOrder = await tx.employeeDepartment.findFirst({
          where: { departmentId },
          orderBy: { sortOrder: 'desc' },
          select: { sortOrder: true },
        });

        await tx.employeeDepartment.create({
          data: {
            departmentId,
            employeeId,
            isPrimary: createsPrimary,
            sortOrder: (maxSortOrder?.sortOrder ?? -1) + 1,
            ...auditCreateOnly(currentUser),
          },
        });

        return { message: '添加成功' };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = error.meta?.target;
        const targetText = Array.isArray(target) ? target.join(',') : String(target ?? '');
        if (targetText.includes('departmentId')) {
          throw new BadRequestException('该员工已在此部门中');
        }
        throw new ConflictException('该员工的主部门已被并发修改，请刷新后重试');
      }
      throw error;
    }
  }

  /**
   * 从部门移除员工
   */
  async removeEmployee(departmentId: string, employeeId: string) {
    return this.prisma.$transaction(async (tx) => {
      await lockEmployeeDepartmentWrites(tx, employeeId);

      const department = await tx.department.findFirst({
        where: { id: departmentId, deletedAt: null },
        select: { id: true },
      });
      if (!department) {
        throw new NotFoundException(`部门 ${departmentId} 不存在`);
      }

      const existing = await tx.employeeDepartment.findFirst({
        where: { departmentId, employeeId },
        select: { id: true, isPrimary: true },
      });
      if (!existing) {
        throw new BadRequestException('该员工不在此部门中');
      }

      await tx.employeeDepartment.delete({
        where: { id: existing.id },
      });

      if (existing.isPrimary) {
        const promoted = await tx.employeeDepartment.findFirst({
          where: { employeeId },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: { id: true },
        });
        if (promoted) {
          await tx.employeeDepartment.update({
            where: { id: promoted.id },
            data: { isPrimary: true },
          });
        }
      }

      return { message: '移除成功' };
    });
  }

  /**
   * 转换响应 DTO
   */
  private toResponseDto(department: DepartmentWithRelations): DepartmentResponseOutput {
    return serializeEntity<DepartmentResponseOutput>({
      id: department.id,
      name: department.name,
      parentId: department.parentId ?? null,
      sortOrder: department.sortOrder,
      status: department.status as 'active' | 'inactive',
      managerId: department.managerId ?? null,
      dingtalkDeptId: department.dingtalkDeptId ?? undefined,
      dingtalkParentId: department.dingtalkParentId ?? undefined,
      createDeptGroup: department.createDeptGroup,
      autoAddUser: department.autoAddUser,
      lastSyncAt: department.lastSyncAt ? department.lastSyncAt.toISOString() : undefined,
      createdAt: department.createdAt.toISOString(),
      updatedAt: department.updatedAt.toISOString(),
      version: department.version,
      parent: department.parent
        ? {
            id: department.parent.id,
            name: department.parent.name,
            parentId: department.parent.parentId ?? null,
          }
        : null,
      manager: department.manager
        ? { id: department.manager.id, name: department.manager.name }
        : null,
      employeeCount: department._count?.employees ?? 0,
      childrenCount: department._count?.children ?? 0,
    });
  }
}
