import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';

export interface DashboardStats {
  customerCount: number;
  opportunityCount: number;
  saleOrderCount: number;
}

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  /**
   * 获取仪表盘基础统计数据
   */
  async getStats(chargerScope?: string[] | null): Promise<DashboardStats> {
    const scopeFilter = chargerScope ? { chargerId: { in: chargerScope } } : {};

    const [customerCount, opportunityCount, saleOrderCount] = await Promise.all([
      this.prisma.customer.count({ where: { deletedAt: null, ...scopeFilter } }),
      this.prisma.opportunity.count({ where: { deletedAt: null, ...scopeFilter } }),
      this.prisma.saleOrder.count({ where: { deletedAt: null, ...scopeFilter } }),
    ]);

    return {
      customerCount,
      opportunityCount,
      saleOrderCount,
    };
  }
}
