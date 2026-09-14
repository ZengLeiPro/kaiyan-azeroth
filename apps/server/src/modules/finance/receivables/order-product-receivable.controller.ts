import { Body, Controller, Post } from '@nestjs/common';

import { CurrentUser, CurrentUserType } from '../../auth/decorators/current-user.decorator';
import { RequireFreshJwt } from '../../auth/decorators/fresh-jwt.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { ReconcileOrderProductReceivablesDto } from './dto/reconcile-order-product-receivables.dto';
import {
  OrderProductReceivableService,
  type ReconcileResult,
} from './order-product-receivable.service';

/**
 * OrderProduct.totalReceivedAmount 反向缓存修复端点（绑定方案 v2.2 Phase 3）
 *
 * 需要 finance.ledger.edit + 最近认证 JWT。
 *
 * 用法：
 *  - dryRun=true（默认）→ 只汇报失同步行数，不写库
 *  - dryRun=false      → 同事务修复所有失同步行
 *  - orderProductIds 限定子集；不传则全表
 *
 * 触发场景：
 *  - watchdog cron 报警后 admin 主动修
 *  - 历史回填 Phase 10 全表初始化（dryRun=false + 不传 orderProductIds）
 *  - 偶发数据漂移修补
 */
@Controller('finance')
export class OrderProductReceivableController {
  constructor(private readonly service: OrderProductReceivableService) {}

  @Post('reconcile-order-product-receivables')
  @RequirePermission({ module: 'finance', menu: 'ledger', action: 'edit' })
  @RequireFreshJwt()
  async reconcile(
    @Body() body: ReconcileOrderProductReceivablesDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ success: boolean; result: ReconcileResult }> {
    const result = await this.service.reconcile({
      orderProductIds: body.orderProductIds,
      dryRun: body.dryRun,
    });
    // 显式标注调用者，便于审计追溯
    void user;
    return { success: true, result };
  }
}
