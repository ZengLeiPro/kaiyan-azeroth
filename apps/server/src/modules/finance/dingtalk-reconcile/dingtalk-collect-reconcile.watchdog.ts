import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { toJsonValue } from '../../../common/utils/json-type-helpers';
import { DingtalkMessengerService } from '../../dingtalk-messenger/dingtalk-messenger.service';
import {
  DingtalkCollectReconcileService,
  type DingtalkMonthlyRow,
} from './dingtalk-collect-reconcile.service';

/**
 * dingtalk_collect 月度对账 cron（绑定方案 v2.2 Phase 4 + Phase 7）
 *
 * 每月 02 号 04:00 跑「上一个月」对账：
 *  - 上月返佣率在 [5%, 15%] 区间 → 静默
 *  - 偏离 → logger.error + 写 OperationLog + 推钉钉告警（v2.2 Phase 7）
 *
 * 上月计算：
 *   - 1 号 04:00 跑可能数据未到齐；2 号 04:00 更稳
 *   - 不能用 Date.now() / new Date()（环境限制），改用 SQL 算"max(businessDate) 所在月的上一个月"
 *
 * 钉钉告警目标读 env `WATCHDOG_ALERT_DINGTALK_USER_IDS`（逗号分隔 dingtalkUserId）；
 * 未配置时静默退化（不报警，仅写 OperationLog）。
 */
@Injectable()
export class DingtalkCollectReconcileWatchdog {
  private readonly logger = new Logger(DingtalkCollectReconcileWatchdog.name);

  constructor(
    private readonly service: DingtalkCollectReconcileService,
    private readonly prisma: PrismaService,
    private readonly dingtalk: DingtalkMessengerService,
    private readonly config: ConfigService
  ) {}

  @Cron('0 4 2 * *')
  async handleMonthlyAudit(): Promise<void> {
    this.logger.log('dingtalk_collect 月度对账（cron）开始');
    try {
      const lastMonth = await this.resolveLastMonthFromData();
      if (!lastMonth) {
        this.logger.log('暂无 dingtalk_collect 数据，跳过');
        return;
      }

      const check = await this.service.checkMonth(lastMonth);
      if (check.rateOk) {
        this.logger.log(
          `月份 ${lastMonth} 对账正常：${check.reason}` +
            (check.row?.commissionRate != null
              ? ` (返佣率=${(check.row.commissionRate * 100).toFixed(2)}%)`
              : '')
        );
        return;
      }

      this.logger.error(`月份 ${lastMonth} 对账异常：${check.reason}`);
      await this.prisma.operationLog.create({
        data: {
          module: 'finance',
          action: 'watchdog',
          target: 'dingtalk-collect-rate-out-of-bounds',
          details: toJsonValue({
            month: lastMonth,
            reason: check.reason,
            row: check.row,
          }),
        },
      });

      await this.pushDingtalkAlert(lastMonth, check.reason, check.row);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`对账失败：${msg}`);
    }
  }

  /**
   * 从数据库取「数据最晚月份的上一个月」作为对账目标
   * 避免依赖 Date.now()（环境限制）
   */
  private async resolveLastMonthFromData(): Promise<string | null> {
    // @prisma-raw-sql: 一次拿"PaymentItem.payment.businessDate 最大值的月份"，Prisma ORM
    // 跨表 MAX 不便达，走原生 SQL。无参数（zero-arg tagged template）安全
    const rows = await this.prisma.$queryRaw<Array<{ max_month: string | null }>>`
      SELECT to_char(MAX(p."businessDate"), 'YYYY-MM') AS max_month
      FROM payment_items pi
      JOIN payments p ON p.id = pi."paymentId"
      WHERE pi."paymentMode" = 'dingtalk_collect'
        AND pi."deletedAt" IS NULL
        AND p."flowStatus" = 'approved'
        AND p."deletedAt" IS NULL
    `;
    const maxMonth = rows[0]?.max_month;
    if (!maxMonth) return null;
    // maxMonth 的上一个月
    const [y, m] = maxMonth.split('-').map(Number);
    if (!y || !m) return null;
    let prevY = y;
    let prevM = m - 1;
    if (prevM === 0) {
      prevM = 12;
      prevY -= 1;
    }
    return `${prevY}-${String(prevM).padStart(2, '0')}`;
  }

  /**
   * 月度对账偏离合理区间时推钉钉告警。
   *
   * - 未配置 WATCHDOG_ALERT_DINGTALK_USER_IDS → 静默退化（warn 一行）
   * - 钉钉调用失败被自身 try/catch 兜底，确保 cron 主流程不阻塞
   */
  private async pushDingtalkAlert(
    month: string,
    reason: string,
    row: DingtalkMonthlyRow | null
  ): Promise<void> {
    const userIds = this.parseAlertUserIds();
    if (userIds.length === 0) {
      this.logger.warn(
        'WATCHDOG_ALERT_DINGTALK_USER_IDS 未配置，跳过钉钉告警（仅写 OperationLog）'
      );
      return;
    }

    const ratePart =
      row?.commissionRate != null ? `${(row.commissionRate * 100).toFixed(2)}%` : 'N/A';
    const collectPart = row?.collectTotal ?? 'N/A';
    const commissionPart = row?.commissionReceived ?? 'N/A';

    const markdown =
      `**月份 ${month} 返佣率偏离合理区间 ⚠**\n\n` +
      `- 原因：${reason}\n` +
      `- 返佣率：${ratePart}\n` +
      `- dingtalk_collect 合计：¥${collectPart}\n` +
      `- 佣金已挂账：¥${commissionPart}`;

    try {
      await this.dingtalk.sendActionCardToUsers({
        dingtalkUserIds: userIds,
        title: `dingtalk_collect ${month} 对账异常`,
        markdown,
        singleTitle: '查看 OperationLog',
        singleUrl:
          'http://localhost:5173/operation-logs?target=dingtalk-collect-rate-out-of-bounds',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`钉钉告警发送异常（已吞掉，不影响 cron 主流程）：${msg}`);
    }
  }

  private parseAlertUserIds(): string[] {
    const raw = this.config.get<string>('WATCHDOG_ALERT_DINGTALK_USER_IDS') ?? '';
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
}
