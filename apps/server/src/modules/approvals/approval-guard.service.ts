import { APPROVAL_EVENT_REGISTRY } from '@ky-azeroth/shared/constants';
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * 审批守卫服务 - 通用审批检查
 *
 * 提供统一的审批配置检查能力，业务 Service 注入后即可使用。
 * 判断逻辑：某事件类型是否存在 active 状态的审批流程。
 */
@Injectable()
export class ApprovalGuardService {
  constructor(private prisma: PrismaService) {}

  /**
   * 检查某事件类型是否需要审批
   * @param eventType 事件类型（如 'sale_order_activate'）
   * @returns 是否需要审批
   */
  async isRequired(eventType: string): Promise<boolean> {
    const flow = await this.prisma.approvalFlow.findFirst({
      where: {
        eventType,
        status: 'active',
      },
      select: { id: true },
    });
    return !!flow;
  }

  /**
   * 获取初始审批状态
   * - 需要审批：返回 'draft'
   * - 不需要审批：返回 'approved'
   */
  async getInitialStatus(eventType: string): Promise<'draft' | 'approved'> {
    const required = await this.isRequired(eventType);
    return required ? 'draft' : 'approved';
  }

  /**
   * 获取所有模块的审批配置状态
   * 用于审批流程管理页面展示
   */
  async getAllModuleStatus() {
    // 查询所有非删除的流程，按事件类型分组
    const allFlows = await this.prisma.approvalFlow.findMany({
      where: { status: { not: 'deleted' } },
      select: {
        id: true,
        name: true,
        eventType: true,
        version: true,
        status: true,
      },
      orderBy: { version: 'desc' },
    });

    // 按事件类型分组
    const flowsByType = new Map<string, typeof allFlows>();
    for (const flow of allFlows) {
      const list = flowsByType.get(flow.eventType) || [];
      list.push(flow);
      flowsByType.set(flow.eventType, list);
    }

    // 遍历注册表，生成状态列表
    return Object.entries(APPROVAL_EVENT_REGISTRY)
      .map(([eventType, config]) => {
        const flows = flowsByType.get(eventType) || [];
        const activeFlow = flows.find((f) => f.status === 'active');
        return {
          eventType,
          label: config.label,
          category: config.category,
          categoryLabel: config.categoryLabel,
          sortOrder: config.sortOrder,
          enabled: !!activeFlow,
          hasFlows: flows.length > 0,
          activeFlow: activeFlow
            ? {
                id: activeFlow.id,
                name: activeFlow.name,
                version: activeFlow.version,
              }
            : null,
        };
      })
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }
}
