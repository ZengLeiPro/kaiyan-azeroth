import { Controller, Get, Query } from '@nestjs/common';

import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import {
  DingtalkCollectReconcileService,
  type DingtalkMonthlyRow,
} from './dingtalk-collect-reconcile.service';

/**
 * dingtalk_collect 月度对账查询端点（绑定方案 v2.2 Phase 4）
 *
 * 需要 finance.ledger.view。
 *
 * 用法：GET /finance/dingtalk-collect-monthly?fromMonth=2025-01&toMonth=2026-06
 *
 * 不传月份参数 → 默认全表（2020-01 至 2099-12 自动按数据收敛）
 */
@Controller('finance')
export class DingtalkCollectReconcileController {
  constructor(private readonly service: DingtalkCollectReconcileService) {}

  @Get('dingtalk-collect-monthly')
  @RequirePermission({ module: 'finance', menu: 'ledger', action: 'view' })
  async monthly(
    @Query('fromMonth') fromMonth?: string,
    @Query('toMonth') toMonth?: string
  ): Promise<{ success: boolean; rows: DingtalkMonthlyRow[] }> {
    const rows = await this.service.monthlyReconcile({ fromMonth, toMonth });
    return { success: true, rows };
  }
}
