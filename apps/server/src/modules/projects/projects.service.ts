import type { ProjectResponseOutput } from '@ky-azeroth/shared/schemas';
import type { IProjectSelectionOption } from '@ky-azeroth/shared/types/project';
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
import { auditCreate, auditUpdate } from '../../common/utils/audit-helper';
import { calculatePagination, serializeEntity } from '../../common/utils/response-helpers';
import { lockSaleOrderGraph } from '../sale-orders/sale-order-lock-protocol.helper';
import { CreateProjectDto } from './dto/create-project.dto';
import { QueryProjectDto } from './dto/query-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { PROJECT_FILTER_REGISTRY } from './projects.filter-registry';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly filterApplier: FilterApplierService
  ) {}

  /**
   * 创建项目
   */
  async create(
    createProjectDto: CreateProjectDto,
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<ProjectResponseOutput> {
    const saleOrderHint = createProjectDto.saleOrderId
      ? await this.prisma.saleOrder.findFirst({
          where: { id: createProjectDto.saleOrderId, deletedAt: null },
          select: { id: true, opportunityId: true, customerId: true },
        })
      : null;
    if (createProjectDto.saleOrderId && !saleOrderHint) {
      throw new BadRequestException('合同订单不存在或已删除');
    }
    try {
      const project = await this.prisma.$transaction(async (tx) => {
        const lockedOrders = await lockSaleOrderGraph(tx, {
          saleOrderIds: [createProjectDto.saleOrderId],
          relationshipOpportunityIds: [
            createProjectDto.opportunityId,
            saleOrderHint?.opportunityId,
          ],
          discoverSaleOrdersForOpportunityIds: [createProjectDto.opportunityId],
          customerIds: [createProjectDto.customerId, saleOrderHint?.customerId],
        });
        this.assertLockedSaleOrderHint(lockedOrders, saleOrderHint);
        const relations = await this.resolveRelationContext(tx, {
          customerId: createProjectDto.customerId,
          opportunityId: createProjectDto.opportunityId,
          saleOrderId: createProjectDto.saleOrderId,
        });
        return tx.project.create({
          data: {
            name: createProjectDto.name,
            description: createProjectDto.description ?? undefined,
            status: createProjectDto.status ?? undefined,
            logicalStatus: createProjectDto.logicalStatus ?? undefined,
            category: createProjectDto.category ?? undefined,
            customerId: relations.customerId ?? undefined,
            opportunityId: relations.opportunityId ?? undefined,
            saleOrderId: relations.saleOrderId ?? undefined,
            startDate: createProjectDto.startDate
              ? new Date(createProjectDto.startDate)
              : undefined,
            endDate: createProjectDto.endDate ? new Date(createProjectDto.endDate) : undefined,
            ownerId: createProjectDto.ownerId ?? undefined,
            ...auditCreate(currentUser),
          },
        });
      });
      return serializeEntity<ProjectResponseOutput>(project);
    } catch (error) {
      this.rethrowRelationConflict(error);
    }
  }

  /**
   * 查询项目列表
   *
   * 支持的排序字段（白名单）：name / status / createdAt / updatedAt / totalHours
   * 其他 sortBy 值兜底为 createdAt desc。
   *
   * 双路径：
   *   - 路径 A（默认）：sortBy 不是 totalHours 且无 totalHours min/max 过滤 →
   *     Prisma 分页拿当页 → groupBy 补当页工时。SQL 量 O(pageSize)。
   *   - 路径 B：sortBy='totalHours' 或带 totalHours 范围筛选 →
   *     拿 where 命中的全量精简字段 → groupBy 一次性聚合 → 内存里筛选/排序/分页 →
   *     再 findMany 拿当页完整数据。SQL 量 O(N) where 命中行（当前 N≈344，可忽略；
   *     N>10000 时需改成 raw SQL）。
   */
  async findAll(
    query: QueryProjectDto,
    rawQuery?: unknown
  ): Promise<PaginatedResponse<ProjectResponseOutput>> {
    const { page = 1, pageSize = 20, sortBy, sortOrder = 'desc' } = query;
    const { skip } = calculatePagination(page, pageSize);

    // Project 列表目前不走 DataScope（组织/项目视角，所有人都能看）。
    // 若未来需要收紧，可以从 controller 传 chargerScope=resolveChargerScope(...)，
    // 同时 registry 的 ownerId 已标记 isScopeField。
    const where = await this.filterApplier.buildWhere<Prisma.ProjectWhereInput>({
      registry: PROJECT_FILTER_REGISTRY,
      rawQuery,
      legacyKeyword: query.keyword,
      legacyFilters: {
        status: query.status,
        category: query.category,
        ownerId: query.ownerId,
        customerId: query.customerId,
      },
      chargerScope: null,
      baseWhere: { deletedAt: null },
    });

    const totalHoursRange = parseTotalHoursRange(rawQuery);
    const sortField = resolveProjectSortField(sortBy);

    if (sortField === 'totalHours' || totalHoursRange !== null) {
      return this.findAllAggregated({
        where,
        page,
        pageSize,
        skip,
        sortField,
        sortOrder,
        totalHoursRange,
      });
    }

    // 路径 A：sortBy 不涉及聚合字段，直接 Prisma 分页 + 补当页 totalHours
    const orderBy: Prisma.ProjectOrderByWithRelationInput = sortField
      ? { [sortField]: sortOrder }
      : { createdAt: 'desc' };

    const [total, data] = await Promise.all([
      this.prisma.project.count({ where }),
      this.prisma.project.findMany({
        where,
        skip,
        take: pageSize,
        orderBy,
        include: {
          owner: { select: { id: true, name: true } },
          customer: { select: { id: true, customerName: true } },
          opportunity: { select: { id: true, opportunityName: true } },
          saleOrder: { select: { id: true, orderTitle: true } },
        },
      }),
    ]);

    const hoursMap = await this.aggregateTotalHours(data.map((item) => item.id));

    return {
      items: data.map((item) =>
        serializeEntity<ProjectResponseOutput>({
          ...item,
          ownerName: item.owner?.name ?? item.ownerName,
          customerName: item.customer?.customerName ?? null,
          opportunityName: item.opportunity?.opportunityName ?? null,
          orderTitle: item.saleOrder?.orderTitle ?? null,
          totalHours: hoursMap.get(item.id) ?? 0,
        })
      ),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 路径 B：涉及 totalHours 聚合的排序/筛选。
   *
   * 步骤：① select 精简字段全量加载 where 命中行 → ② groupBy 一次性聚合工时 →
   * ③ 内存合并 + min/max 过滤 + 排序 + 分页 → ④ 用当页 ID 拿完整记录 +
   * relations，按既定顺序返回。
   */
  private async findAllAggregated(args: {
    where: Prisma.ProjectWhereInput;
    page: number;
    pageSize: number;
    skip: number;
    sortField: ProjectSortField | null;
    sortOrder: 'asc' | 'desc';
    totalHoursRange: { min?: number; max?: number } | null;
  }): Promise<PaginatedResponse<ProjectResponseOutput>> {
    const { where, page, pageSize, skip, sortField, sortOrder, totalHoursRange } = args;

    // ① 精简字段全量：拿 id + 内存排序所需字段
    const matched = await this.prisma.project.findMany({
      where,
      select: {
        id: true,
        name: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (matched.length === 0) {
      return { items: [], total: 0, page, pageSize, totalPages: 0 };
    }

    // ② groupBy 聚合工时
    const hoursMap = await this.aggregateTotalHours(matched.map((p) => p.id));

    // ③ 合并 + 过滤 + 排序 + 分页（内存）
    let enriched = matched.map((p) => ({
      ...p,
      totalHours: hoursMap.get(p.id) ?? 0,
    }));

    if (totalHoursRange !== null) {
      enriched = enriched.filter((p) => {
        if (totalHoursRange.min !== undefined && p.totalHours < totalHoursRange.min) return false;
        if (totalHoursRange.max !== undefined && p.totalHours > totalHoursRange.max) return false;
        return true;
      });
    }

    const cmp = (a: number | string | Date, b: number | string | Date): number => {
      if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
      if (typeof a === 'number' && typeof b === 'number') return a - b;
      return String(a).localeCompare(String(b));
    };
    const dir = sortOrder === 'asc' ? 1 : -1;
    const effectiveSortField: ProjectSortField = sortField ?? 'createdAt';
    enriched.sort((a, b) => dir * cmp(a[effectiveSortField], b[effectiveSortField]));

    const total = enriched.length;
    const paged = enriched.slice(skip, skip + pageSize);

    if (paged.length === 0) {
      return { items: [], total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
    }

    // ④ 当页 ID 拿完整数据 + relations
    const records = await this.prisma.project.findMany({
      where: { id: { in: paged.map((p) => p.id) } },
      include: {
        owner: { select: { id: true, name: true } },
        customer: { select: { id: true, customerName: true } },
        opportunity: { select: { id: true, opportunityName: true } },
        saleOrder: { select: { id: true, orderTitle: true } },
      },
    });
    const recordMap = new Map(records.map((r) => [r.id, r]));

    const items: ProjectResponseOutput[] = [];
    for (const p of paged) {
      const record = recordMap.get(p.id);
      if (!record) continue;
      items.push(
        serializeEntity<ProjectResponseOutput>({
          ...record,
          ownerName: record.owner?.name ?? record.ownerName,
          customerName: record.customer?.customerName ?? null,
          opportunityName: record.opportunity?.opportunityName ?? null,
          orderTitle: record.saleOrder?.orderTitle ?? null,
          totalHours: p.totalHours,
        })
      );
    }

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  /**
   * 按项目 ID 批量聚合 ACTUAL 工时（实时，无缓存）。
   * EffortRecord 表已有 @@index([projectId])，几百到几千 ID 的 IN 查询无压力。
   */
  private async aggregateTotalHours(projectIds: string[]): Promise<Map<string, number>> {
    if (projectIds.length === 0) return new Map();
    const groups = await this.prisma.effortRecord.groupBy({
      by: ['projectId'],
      where: {
        projectId: { in: projectIds },
        deletedAt: null,
        recordType: 'ACTUAL',
      },
      _sum: { actualTime: true },
    });
    const map = new Map<string, number>();
    for (const g of groups) {
      if (!g.projectId) continue;
      const sum = g._sum.actualTime ? Number(g._sum.actualTime) : 0;
      // 保留 2 位小数（actualTime 是 Decimal(10,2)，避免浮点尾巴）
      map.set(g.projectId, Math.round(sum * 100) / 100);
    }
    return map;
  }

  /**
   * 查询项目详情（含成员与单值 CRM 关联）
   */
  async findOne(id: string): Promise<ProjectResponseOutput> {
    const project = await this.prisma.project.findFirst({
      where: { id, deletedAt: null },
      include: {
        owner: { select: { id: true, name: true } },
        customer: { select: { id: true, customerName: true } },
        opportunity: { select: { id: true, opportunityName: true } },
        saleOrder: {
          select: { id: true, orderTitle: true, orderAmount: true },
        },
        members: { where: { deletedAt: null, isActive: true } },
      },
    });

    if (!project) {
      throw new NotFoundException('项目不存在');
    }

    return serializeEntity<ProjectResponseOutput>({
      ...project,
      ownerName: project.owner?.name ?? project.ownerName,
      customerName: project.customer?.customerName ?? null,
      opportunityName: project.opportunity?.opportunityName ?? null,
      orderTitle: project.saleOrder?.orderTitle ?? null,
      saleOrders: project.saleOrder
        ? [
            {
              id: project.saleOrder.id,
              saleOrderId: project.saleOrder.id,
              orderTitle: project.saleOrder.orderTitle ?? null,
              orderAmount: project.saleOrder.orderAmount
                ? Number(project.saleOrder.orderAmount)
                : null,
            },
          ]
        : [],
    });
  }

  /**
   * 更新项目
   */
  async update(
    id: string,
    updateProjectDto: UpdateProjectDto,
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<ProjectResponseOutput> {
    const { version: requestVersion } = updateProjectDto;
    const snapshot = await this.prisma.project.findFirst({ where: { id, deletedAt: null } });
    if (!snapshot) throw new NotFoundException('项目不存在');
    const targetSaleOrderId =
      updateProjectDto.saleOrderId !== undefined
        ? updateProjectDto.saleOrderId
        : snapshot.saleOrderId;
    const saleOrderHint = targetSaleOrderId
      ? await this.prisma.saleOrder.findFirst({
          where: { id: targetSaleOrderId, deletedAt: null },
          select: { id: true, opportunityId: true, customerId: true },
        })
      : null;
    if (targetSaleOrderId && !saleOrderHint) {
      throw new BadRequestException('合同订单不存在或已删除');
    }

    try {
      const project = await this.prisma.$transaction(async (tx) => {
        const lockedOrders = await lockSaleOrderGraph(tx, {
          saleOrderIds: [snapshot.saleOrderId, updateProjectDto.saleOrderId],
          relationshipOpportunityIds: [
            snapshot.opportunityId,
            updateProjectDto.opportunityId,
            saleOrderHint?.opportunityId,
          ],
          discoverSaleOrdersForOpportunityIds: [
            snapshot.opportunityId,
            updateProjectDto.opportunityId,
          ],
          customerIds: [
            snapshot.customerId,
            updateProjectDto.customerId,
            saleOrderHint?.customerId,
          ],
        });
        this.assertLockedSaleOrderHint(lockedOrders, saleOrderHint);
        const locked = await tx.project.findFirst({ where: { id, deletedAt: null } });
        if (!locked) throw new ConflictException('项目已被删除，请刷新后重试');
        if (locked.version !== requestVersion) {
          throw new ConflictException(
            `数据已被其他用户修改，当前版本 ${locked.version}。请刷新后重试。`
          );
        }
        const relations = await this.resolveRelationContext(tx, {
          customerId:
            updateProjectDto.customerId !== undefined
              ? updateProjectDto.customerId
              : locked.customerId,
          opportunityId:
            updateProjectDto.opportunityId !== undefined
              ? updateProjectDto.opportunityId
              : locked.opportunityId,
          saleOrderId:
            updateProjectDto.saleOrderId !== undefined
              ? updateProjectDto.saleOrderId
              : locked.saleOrderId,
        });
        const relationMutation =
          updateProjectDto.customerId !== undefined ||
          updateProjectDto.opportunityId !== undefined ||
          updateProjectDto.saleOrderId !== undefined;
        return tx.project.update({
          where: { id, version: requestVersion, deletedAt: null },
          data: {
            name: updateProjectDto.name,
            description:
              updateProjectDto.description !== undefined ? updateProjectDto.description : undefined,
            status: updateProjectDto.status ?? undefined,
            logicalStatus:
              updateProjectDto.logicalStatus !== undefined
                ? updateProjectDto.logicalStatus
                : undefined,
            category:
              updateProjectDto.category !== undefined ? updateProjectDto.category : undefined,
            // 三列共同描述同一 CRM 关系图。任一关系入口变化时必须把锁后校验的
            // 完整三元组一并落盘，不能只写 DTO 显式字段而留下半套关系。
            customerId: relationMutation ? relations.customerId : undefined,
            opportunityId: relationMutation ? relations.opportunityId : undefined,
            saleOrderId: relationMutation ? relations.saleOrderId : undefined,
            startDate:
              updateProjectDto.startDate !== undefined
                ? updateProjectDto.startDate
                  ? new Date(updateProjectDto.startDate)
                  : null
                : undefined,
            endDate:
              updateProjectDto.endDate !== undefined
                ? updateProjectDto.endDate
                  ? new Date(updateProjectDto.endDate)
                  : null
                : undefined,
            ownerId: updateProjectDto.ownerId !== undefined ? updateProjectDto.ownerId : undefined,
            ...auditUpdate(currentUser),
            version: { increment: 1 },
          },
        });
      });
      return serializeEntity<ProjectResponseOutput>(project);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException(
          `数据已被其他用户修改，当前版本 ${snapshot.version}。请刷新后重试。`
        );
      }
      this.rethrowRelationConflict(error);
    }
  }

  /**
   * 删除项目（软删除）
   */
  async remove(
    id: string,
    requestVersion: number,
    currentUser: { id: string; employeeId?: string | null }
  ) {
    const snapshot = await this.prisma.project.findFirst({ where: { id, deletedAt: null } });
    if (!snapshot) throw new NotFoundException('项目不存在');
    await this.prisma.$transaction(async (tx) => {
      await lockSaleOrderGraph(tx, {
        saleOrderIds: [snapshot.saleOrderId],
        relationshipOpportunityIds: [snapshot.opportunityId],
        discoverSaleOrdersForOpportunityIds: [snapshot.opportunityId],
        customerIds: [snapshot.customerId],
      });
      const locked = await tx.project.findFirst({ where: { id, deletedAt: null } });
      if (!locked || locked.version !== requestVersion) {
        throw new ConflictException('项目已被修改或删除，请刷新后重试');
      }
      await tx.project.update({
        where: { id, version: requestVersion, deletedAt: null },
        data: {
          deletedAt: new Date(),
          opportunityId: null,
          saleOrderId: null,
          ...auditUpdate(currentUser),
          version: { increment: 1 },
        },
      });
    });

    return { success: true };
  }

  // ========== 项目成员管理 ==========

  /**
   * 添加项目成员
   */
  async addMember(
    projectId: string,
    data: { employeeId: string; userName?: string | null; role?: string | null },
    currentUser: { id: string; employeeId?: string | null }
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const project = await tx.project.findFirst({ where: { id: projectId, deletedAt: null } });
        if (!project) throw new NotFoundException('项目不存在');
        const existing = await tx.projectMember.findFirst({
          where: { projectId, employeeId: data.employeeId },
        });
        if (existing?.deletedAt || existing?.isActive === false) {
          return tx.projectMember.update({
            where: { id: existing.id, version: existing.version },
            data: {
              userName: data.userName,
              role: data.role,
              isActive: true,
              deletedAt: null,
              joinedAt: new Date(),
              ...auditUpdate(currentUser),
              version: { increment: 1 },
            },
          });
        }
        if (existing) throw new ConflictException('该员工已是项目成员');
        return tx.projectMember.create({
          data: {
            projectId,
            employeeId: data.employeeId,
            userName: data.userName,
            role: data.role,
            joinedAt: new Date(),
            ...auditCreate(currentUser),
          },
        });
      });
    } catch (error) {
      this.rethrowMemberConflict(error);
    }
  }

  /**
   * 移除项目成员
   */
  async removeMember(
    projectId: string,
    memberId: string,
    requestVersion: number,
    currentUser: { id: string; employeeId?: string | null }
  ) {
    try {
      await this.prisma.projectMember.update({
        where: { id: memberId, projectId, version: requestVersion, deletedAt: null },
        data: {
          isActive: false,
          deletedAt: new Date(),
          ...auditUpdate(currentUser),
          version: { increment: 1 },
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException('项目成员已被修改或移除，请刷新后重试');
      }
      this.rethrowMemberConflict(error);
    }

    return { success: true };
  }

  /**
   * 获取项目成员列表
   */
  async getMembers(projectId: string) {
    await this.findOne(projectId);

    return this.prisma.projectMember.findMany({
      where: { projectId, deletedAt: null, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ========== 项目-订单关联管理 ==========

  /**
   * 关联销售订单到项目
   */
  async linkSaleOrder(
    projectId: string,
    saleOrderId: string,
    requestVersion: number,
    currentUser: { id: string; employeeId?: string | null }
  ) {
    const saleOrder = await this.prisma.saleOrder.findFirst({
      where: { id: saleOrderId, deletedAt: null },
      select: {
        id: true,
        customerId: true,
        opportunityId: true,
        orderTitle: true,
        orderAmount: true,
      },
    });
    if (!saleOrder) throw new NotFoundException('合同订单不存在');

    await this.update(
      projectId,
      {
        saleOrderId,
        version: requestVersion,
      },
      currentUser
    );

    return serializeEntity({
      id: saleOrder.id,
      saleOrderId: saleOrder.id,
      orderTitle: saleOrder.orderTitle ?? null,
      orderAmount: saleOrder.orderAmount ? Number(saleOrder.orderAmount) : null,
    });
  }

  /**
   * 解除项目与销售订单的关联
   */
  async unlinkSaleOrder(
    projectId: string,
    saleOrderId: string,
    requestVersion: number,
    currentUser: { id: string; employeeId?: string | null }
  ) {
    const project = await this.findOne(projectId);
    if (project.saleOrderId !== saleOrderId) {
      throw new NotFoundException('项目与订单的关联不存在');
    }

    await this.update(projectId, { saleOrderId: null, version: requestVersion }, currentUser);

    return { success: true };
  }

  /** 校验项目、商机、合同订单必须属于同一客户且保持单值关联。 */
  private async resolveRelationContext(
    client: Prisma.TransactionClient,
    input: {
      customerId?: string | null;
      opportunityId?: string | null;
      saleOrderId?: string | null;
    }
  ): Promise<{
    customerId: string | null;
    opportunityId: string | null;
    saleOrderId: string | null;
  }> {
    const saleOrder = input.saleOrderId
      ? await client.saleOrder.findFirst({
          where: { id: input.saleOrderId, deletedAt: null },
          select: { id: true, customerId: true, opportunityId: true },
        })
      : null;
    if (input.saleOrderId && !saleOrder) throw new BadRequestException('合同订单不存在或已删除');

    const opportunityId = input.opportunityId ?? saleOrder?.opportunityId ?? null;
    if (saleOrder && !opportunityId) {
      throw new BadRequestException('合同订单未关联商机，不能关联到项目');
    }
    if (saleOrder?.opportunityId && saleOrder.opportunityId !== opportunityId) {
      throw new BadRequestException('合同订单不属于所选商机');
    }

    const opportunity = opportunityId
      ? await client.opportunity.findFirst({
          where: { id: opportunityId, deletedAt: null },
          select: { id: true, customerId: true },
        })
      : null;
    if (opportunityId && !opportunity) throw new BadRequestException('商机不存在或已删除');

    const customerId = input.customerId ?? opportunity?.customerId ?? saleOrder?.customerId ?? null;
    if (opportunity && customerId !== opportunity.customerId) {
      throw new BadRequestException('项目客户必须与关联商机客户一致');
    }
    if (saleOrder && customerId !== saleOrder.customerId) {
      throw new BadRequestException('项目客户必须与合同订单客户一致');
    }

    return {
      customerId,
      opportunityId,
      saleOrderId: saleOrder?.id ?? null,
    };
  }

  private rethrowRelationConflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = Array.isArray(error.meta?.target)
        ? error.meta.target.map(String)
        : [String(error.meta?.target ?? '')];
      if (target.some((field) => field.includes('opportunityId'))) {
        throw new ConflictException('该商机已关联其他项目');
      }
      if (target.some((field) => field.includes('saleOrderId'))) {
        throw new ConflictException('该合同订单已关联其他项目');
      }
    }
    throw error;
  }

  private assertLockedSaleOrderHint(
    lockedOrders: Array<{
      id: string;
      opportunityId: string | null;
      customerId: string;
      deletedAt: Date | null;
    }>,
    hint: { id: string; opportunityId: string | null; customerId: string } | null
  ): void {
    if (!hint) return;
    const locked = lockedOrders.find((row) => row.id === hint.id);
    if (
      !locked ||
      locked.deletedAt ||
      locked.opportunityId !== hint.opportunityId ||
      locked.customerId !== hint.customerId
    ) {
      throw new ConflictException('合同订单关系已变化，请刷新后重试');
    }
  }

  private rethrowMemberConflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') throw new ConflictException('该员工已是项目成员');
      if (error.code === 'P2003') throw new BadRequestException('项目或员工不存在');
      if (error.code === 'P2025') throw new ConflictException('项目成员状态已变化，请刷新后重试');
    }
    throw error;
  }

  /**
   * 查询所有项目（用于下拉框等场景）
   */
  async findAllForSelection(
    keyword?: string,
    status?: string,
    category?: string
  ): Promise<IProjectSelectionOption[]> {
    const where: Prisma.ProjectWhereInput = {
      deletedAt: null,
      ...(status && { status }),
      ...(category && { category }),
      ...(keyword && {
        OR: [
          { name: { contains: keyword, mode: 'insensitive' as const } },
          {
            customer: {
              is: {
                customerName: { contains: keyword, mode: 'insensitive' as const },
              },
            },
          },
        ],
      }),
    };

    const projects = await this.prisma.project.findMany({
      where,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        status: true,
        category: true,
        customer: { select: { customerName: true } },
      },
    });

    return projects.map((project) => ({
      id: project.id,
      name: project.name,
      status: project.status,
      category: project.category,
      customerName: project.customer?.customerName ?? null,
    }));
  }
}

/** Project 列表允许排序的字段白名单。其他 sortBy 值兜底为 createdAt。 */
type ProjectSortField = 'name' | 'status' | 'createdAt' | 'updatedAt' | 'totalHours';

const PROJECT_SORT_WHITELIST: ReadonlySet<ProjectSortField> = new Set<ProjectSortField>([
  'name',
  'status',
  'createdAt',
  'updatedAt',
  'totalHours',
]);

function resolveProjectSortField(sortBy: string | undefined): ProjectSortField | null {
  if (!sortBy) return null;
  return PROJECT_SORT_WHITELIST.has(sortBy as ProjectSortField)
    ? (sortBy as ProjectSortField)
    : null;
}

/**
 * 从 rawQuery 中解析 totalHours 范围筛选。
 *
 * 兼容三种序列化形式（与前端 useFilterScheme/CrudFilterBar 的 numberRange 控件对齐）：
 * - 嵌套对象：`{ filters: { totalHours: { min, max } } }`
 * - 扁平 bracket：`filters[totalHours][min]=x` / `filters[totalHours][max]=y`
 * - dot 风格：`filters.totalHours.min=x`（FilterApplier 也支持，这里保持一致）
 *
 * 解析结果传给 ProjectsService.findAll 的路径 B 做内存层过滤。任一边界存在即返回，
 * 全 undefined 时返回 null（避免路径 B 误判而触发全量加载）。
 */
function parseTotalHoursRange(rawQuery: unknown): { min?: number; max?: number } | null {
  if (!isRecord(rawQuery)) return null;

  let min: unknown;
  let max: unknown;

  const nestedFilters = isRecord(rawQuery.filters) ? rawQuery.filters : undefined;
  if (nestedFilters && isRecord(nestedFilters.totalHours)) {
    min = nestedFilters.totalHours.min;
    max = nestedFilters.totalHours.max;
  }

  for (const [key, value] of Object.entries(rawQuery)) {
    if (key === 'filters[totalHours][min]' || key === 'filters.totalHours.min') {
      if (min === undefined) min = value;
    } else if (key === 'filters[totalHours][max]' || key === 'filters.totalHours.max') {
      if (max === undefined) max = value;
    }
  }

  const minNum = toFiniteNumber(min);
  const maxNum = toFiniteNumber(max);
  if (minNum === undefined && maxNum === undefined) return null;

  return { min: minNum, max: maxNum };
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
