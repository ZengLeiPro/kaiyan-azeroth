import type { ApprovalFlowResponseOutput } from '@ky-azeroth/shared/schemas/approval';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

import { FilterApplierService } from '../../common/filter-scheme';
import type { PaginatedResponse } from '../../common/interfaces/pagination.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import { auditCreate, auditUpdate } from '../../common/utils/audit-helper';
import { calculatePagination, serializeEntity } from '../../common/utils/response-helpers';
import { APPROVAL_FLOW_FILTER_REGISTRY } from './approval-flows.filter-registry';
import { CreateApprovalFlowDto } from './dto/create-approval-flow.dto';
import { QueryApprovalFlowDto } from './dto/query-approval-flow.dto';
import { UpdateApprovalFlowDto } from './dto/update-approval-flow.dto';

@Injectable()
export class ApprovalFlowsService {
  constructor(
    private prisma: PrismaService,
    private readonly filterApplier: FilterApplierService
  ) {}

  /**
   * 创建新的审批流程
   * - 如果该事件类型已存在激活的流程，则将其停用
   * - 生成新的 groupId 和 code
   */
  async create(
    dto: CreateApprovalFlowDto,
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<ApprovalFlowResponseOutput> {
    return await this.prisma.$transaction(async (tx) => {
      // 1. 停用该事件类型的所有激活流程
      await tx.approvalFlow.updateMany({
        where: { eventType: dto.eventType, status: 'active' },
        data: { status: 'inactive' },
      });

      // 2. 生成 groupId（基于事件类型，确保同一事件类型的所有版本在同一组）
      const groupId = `${dto.eventType}_${randomUUID().slice(0, 8)}`;

      // 3. 生成 code
      const code = `${dto.eventType.toUpperCase()}_V1`;

      // 4. 创建新流程
      const flow = await tx.approvalFlow.create({
        data: {
          groupId,
          code,
          name: dto.name,
          eventType: dto.eventType,
          description: dto.description,
          copyToIds: dto.copyToIds || [],
          version: 1,
          status: 'active',
          ...auditCreate(currentUser),
        },
      });

      // 5. 创建节点
      if (dto.nodes && dto.nodes.length > 0) {
        await tx.approvalFlowNode.createMany({
          data: dto.nodes.map((node, index) => ({
            flowId: flow.id,
            nodeOrder: node.nodeOrder,
            nodeName: node.nodeName || `审批节点${index + 1}`,
            approverType: node.approverType,
            approverUserIds: node.approverUserIds || [],
            approverRoleId: node.approverRoleId,
            managerLevel: node.managerLevel || 1,
            multiType: node.multiType || 'or',
            timeoutHours: node.timeoutHours,
          })),
        });
      }

      const result = await tx.approvalFlow.findUniqueOrThrow({
        where: { id: flow.id },
        include: { nodes: { orderBy: { nodeOrder: 'asc' } } },
      });

      return serializeEntity<ApprovalFlowResponseOutput>(
        result as unknown as Record<string, unknown>
      );
    });
  }

  // @no-optimistic-lock: update 方法实际是创建新版本，非原地修改，不适用乐观锁
  /**
   * 更新审批流程（创建新版本，不是覆盖）
   */
  async update(
    id: string,
    dto: UpdateApprovalFlowDto,
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<ApprovalFlowResponseOutput> {
    const oldFlow = await this.prisma.approvalFlow.findUnique({
      where: { id },
      include: { nodes: { orderBy: { nodeOrder: 'asc' } } },
    });
    if (!oldFlow) {
      throw new NotFoundException('流程不存在');
    }

    return await this.prisma.$transaction(async (tx) => {
      // 1. 停用该事件类型的所有激活流程
      await tx.approvalFlow.updateMany({
        where: { eventType: oldFlow.eventType, status: 'active' },
        data: { status: 'inactive' },
      });

      // 2. 获取该组的最大版本号
      const maxVersionResult = await tx.approvalFlow.aggregate({
        where: { groupId: oldFlow.groupId },
        _max: { version: true },
      });
      const newVersion = (maxVersionResult._max.version || 0) + 1;

      // 3. 生成新 code
      const code = `${oldFlow.eventType.toUpperCase()}_V${newVersion}`;

      // 4. 创建新版本流程
      const newFlow = await tx.approvalFlow.create({
        data: {
          groupId: oldFlow.groupId,
          code,
          name: dto.name || oldFlow.name,
          eventType: oldFlow.eventType,
          description: dto.description !== undefined ? dto.description : oldFlow.description,
          copyToIds: dto.copyToIds !== undefined ? dto.copyToIds : oldFlow.copyToIds,
          version: newVersion,
          status: 'active',
          ...auditCreate(currentUser),
        },
      });

      // 5. 创建节点（使用新配置或复制旧配置）
      const nodesToCreate =
        dto.nodes ||
        oldFlow.nodes.map((n) => ({
          nodeOrder: n.nodeOrder,
          nodeName: n.nodeName,
          approverType: n.approverType,
          approverUserIds: n.approverUserIds,
          approverRoleId: n.approverRoleId,
          managerLevel: n.managerLevel,
          multiType: n.multiType,
          timeoutHours: n.timeoutHours,
        }));

      if (nodesToCreate.length > 0) {
        await tx.approvalFlowNode.createMany({
          data: nodesToCreate.map((node, index) => ({
            flowId: newFlow.id,
            nodeOrder: node.nodeOrder,
            nodeName: node.nodeName || `审批节点${index + 1}`,
            approverType: node.approverType,
            approverUserIds: node.approverUserIds || [],
            approverRoleId: node.approverRoleId,
            managerLevel: node.managerLevel || 1,
            multiType: node.multiType || 'or',
            timeoutHours: node.timeoutHours,
          })),
        });
      }

      const result = await tx.approvalFlow.findUniqueOrThrow({
        where: { id: newFlow.id },
        include: { nodes: { orderBy: { nodeOrder: 'asc' } } },
      });

      return serializeEntity<ApprovalFlowResponseOutput>(
        result as unknown as Record<string, unknown>
      );
    });
  }

  /**
   * 获取审批流程列表（默认只显示激活的流程）
   */
  async findAll(
    query: QueryApprovalFlowDto,
    rawQuery?: unknown
  ): Promise<PaginatedResponse<ApprovalFlowResponseOutput>> {
    const { page, pageSize } = query;
    const { skip } = calculatePagination(page, pageSize);

    // 默认展示所有未删除流程（active + inactive），deleted 通过 deletedAt/status 双条件排除。
    // 用户主动停用后仍能在列表里看到并一键激活；只有软删除才不出现在默认视图。
    // 若前端显式传 status（含 'deleted'），FilterApplier 里的 filters[status] 会覆盖 baseWhere.status。
    const baseWhere: Prisma.ApprovalFlowWhereInput = {
      deletedAt: null,
      status: { not: 'deleted' },
    };
    // legacy query.status 显式传值时优先使用
    if (query.status) {
      baseWhere.status = query.status;
    }

    const where = await this.filterApplier.buildWhere<Prisma.ApprovalFlowWhereInput>({
      registry: APPROVAL_FLOW_FILTER_REGISTRY,
      rawQuery,
      legacyFilters: {
        eventType: query.eventType,
        // 注意：不把 legacy status 放到 filters，因为我们在 baseWhere 里已经处理了默认值；
        // 如果放进来会让 applier 再包一层 AND 带 status: { in: [query.status] }，语义不变但冗余。
      },
      chargerScope: null,
      baseWhere,
    });

    const [items, total] = await Promise.all([
      this.prisma.approvalFlow.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: { nodes: { orderBy: { nodeOrder: 'asc' } } },
      }),
      this.prisma.approvalFlow.count({ where }),
    ]);

    return {
      items: items.map((item) =>
        serializeEntity<ApprovalFlowResponseOutput>(item as unknown as Record<string, unknown>)
      ),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 获取单个审批流程详情
   */
  async findOne(id: string): Promise<ApprovalFlowResponseOutput> {
    const flow = await this.prisma.approvalFlow.findFirst({
      where: { id, deletedAt: null },
      include: { nodes: { orderBy: { nodeOrder: 'asc' } } },
    });
    if (!flow) {
      throw new NotFoundException('流程不存在');
    }
    return serializeEntity<ApprovalFlowResponseOutput>(flow as unknown as Record<string, unknown>);
  }

  /**
   * 获取指定事件类型的激活流程
   */
  async findActiveByEventType(eventType: string): Promise<ApprovalFlowResponseOutput | null> {
    const flow = await this.prisma.approvalFlow.findFirst({
      where: { eventType, status: 'active' },
      include: { nodes: { orderBy: { nodeOrder: 'asc' } } },
    });
    if (!flow) return null;
    return serializeEntity<ApprovalFlowResponseOutput>(flow as unknown as Record<string, unknown>);
  }

  /**
   * 获取版本历史（同一 groupId 的所有版本）
   */
  async findVersionHistory(groupId: string): Promise<ApprovalFlowResponseOutput[]> {
    const items = await this.prisma.approvalFlow.findMany({
      where: {
        groupId,
        deletedAt: null,
        status: { not: 'deleted' },
      },
      orderBy: { version: 'desc' },
      include: { nodes: { orderBy: { nodeOrder: 'asc' } } },
    });

    return items.map((item) =>
      serializeEntity<ApprovalFlowResponseOutput>(item as unknown as Record<string, unknown>)
    );
  }

  /**
   * 软删除流程（标记为 deleted）
   */
  async remove(
    id: string,
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<{ success: boolean }> {
    const flow = await this.prisma.approvalFlow.findUnique({
      where: { id },
      include: { instances: { take: 1 } },
    });
    if (!flow) {
      throw new NotFoundException('流程不存在');
    }
    if (flow.status === 'active' && flow.instances.length > 0) {
      throw new BadRequestException('该流程有正在进行的审批实例，无法删除');
    }

    await this.prisma.approvalFlow.update({
      where: { id },
      data: { status: 'deleted', deletedAt: new Date(), ...auditUpdate(currentUser) },
    });

    return { success: true };
  }

  /**
   * 启用模块审批：激活该事件类型的最新版本流程
   */
  async enableModule(
    eventType: string
  ): Promise<{ enabled: boolean; hasFlow: boolean; flow?: ApprovalFlowResponseOutput }> {
    const latestFlow = await this.prisma.approvalFlow.findFirst({
      where: { eventType, status: { not: 'deleted' } },
      orderBy: { version: 'desc' },
    });

    if (!latestFlow) {
      return { enabled: false, hasFlow: false };
    }

    return await this.prisma.$transaction(async (tx) => {
      await tx.approvalFlow.updateMany({
        where: { eventType, status: 'active' },
        data: { status: 'inactive' },
      });

      const activated = await tx.approvalFlow.update({
        where: { id: latestFlow.id },
        data: { status: 'active' },
        include: { nodes: { orderBy: { nodeOrder: 'asc' } } },
      });

      return {
        enabled: true,
        hasFlow: true,
        flow: serializeEntity<ApprovalFlowResponseOutput>(
          activated as unknown as Record<string, unknown>
        ),
      };
    });
  }

  /**
   * 停用模块审批
   */
  async disableModule(eventType: string): Promise<{ disabled: boolean; count: number }> {
    const result = await this.prisma.approvalFlow.updateMany({
      where: { eventType, status: 'active' },
      data: { status: 'inactive' },
    });

    return { disabled: true, count: result.count };
  }

  /**
   * 停用指定流程（active → inactive）
   * - 只对 active 流程操作；inactive 幂等返回；deleted 报错
   * - 与 disableModule 相比，本方法按 flow id 粒度操作，用于列表/历史页单行按钮
   * - 允许对有进行中实例的 flow 停用（与 disableModule 行为对齐，
   *   已存在的实例继续按快照跑，只是新事件不再进入该流程）
   */
  async deactivateFlow(
    id: string,
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<ApprovalFlowResponseOutput> {
    const flow = await this.prisma.approvalFlow.findUnique({ where: { id } });
    if (!flow) {
      throw new NotFoundException('流程不存在');
    }
    if (flow.status === 'deleted') {
      throw new BadRequestException('已删除的流程无法停用');
    }
    if (flow.status === 'inactive') {
      // 幂等：已停用直接返回当前状态
      const current = await this.prisma.approvalFlow.findUniqueOrThrow({
        where: { id },
        include: { nodes: { orderBy: { nodeOrder: 'asc' } } },
      });
      return serializeEntity<ApprovalFlowResponseOutput>(
        current as unknown as Record<string, unknown>
      );
    }

    const deactivated = await this.prisma.approvalFlow.update({
      where: { id },
      data: { status: 'inactive', ...auditUpdate(currentUser) },
      include: { nodes: { orderBy: { nodeOrder: 'asc' } } },
    });

    return serializeEntity<ApprovalFlowResponseOutput>(
      deactivated as unknown as Record<string, unknown>
    );
  }

  /**
   * 激活指定版本的流程
   */
  async activateVersion(id: string): Promise<ApprovalFlowResponseOutput> {
    const flow = await this.prisma.approvalFlow.findUnique({
      where: { id },
    });
    if (!flow) {
      throw new NotFoundException('流程不存在');
    }
    if (flow.status === 'deleted') {
      throw new BadRequestException('已删除的流程无法激活');
    }

    return await this.prisma.$transaction(async (tx) => {
      await tx.approvalFlow.updateMany({
        where: { eventType: flow.eventType, status: 'active' },
        data: { status: 'inactive' },
      });

      const activated = await tx.approvalFlow.update({
        where: { id },
        data: { status: 'active' },
        include: { nodes: { orderBy: { nodeOrder: 'asc' } } },
      });

      return serializeEntity<ApprovalFlowResponseOutput>(
        activated as unknown as Record<string, unknown>
      );
    });
  }
}
