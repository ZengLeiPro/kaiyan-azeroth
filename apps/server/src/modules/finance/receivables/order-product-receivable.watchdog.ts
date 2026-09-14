import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { toJsonValue } from '../../../common/utils/json-type-helpers';
import { DingtalkMessengerService } from '../../dingtalk-messenger/dingtalk-messenger.service';
import { OrderProductReceivableService } from './order-product-receivable.service';

/** 推送给钉钉卡片的失同步样本上限（卡片 markdown 容量与可读性折中） */
const ALERT_SAMPLE_LIMIT = 5;

/**
 * OrderProduct.totalReceivedAmount 反向缓存监控 cron（绑定方案 v2.2 Phase 3 + Phase 7）
 *
 * 每天 03:00 跑 auditFullTable，对比 cache vs 实时聚合：
 *  - 失同步行 == 0 → 静默
 *  - 失同步行 >  0 → logger.error + 写 OperationLog + 推钉钉告警（v2.2 Phase 7）
 *    （admin 用 reconcile endpoint 修复 / 看历史）
 *
 * 钉钉告警目标读 env `WATCHDOG_ALERT_DINGTALK_USER_IDS`（逗号分隔 dingtalkUserId）；
 * 未配置时静默退化（不报警，仅写 OperationLog）。
 * 钉钉接口失败被 DingtalkMessengerService 内部 catch（logger.warn），不阻塞 cron。
 */
@Injectable()
export class OrderProductReceivableWatchdog {
  private readonly logger = new Logger(OrderProductReceivableWatchdog.name);

  constructor(
    private readonly service: OrderProductReceivableService,
    private readonly prisma: PrismaService,
    private readonly dingtalk: DingtalkMessengerService,
    private readonly config: ConfigService
  ) {}

  @Cron('0 3 * * *')
  async handleDailyAudit(): Promise<void> {
    this.logger.log('OrderProduct.totalReceivedAmount 全表对账（cron）开始');
    try {
      const result = await this.service.auditFullTable();
      if (result.outOfSync.length === 0) {
        this.logger.log(`对账完成：${result.checked} 行全同步 ✅`);
        return;
      }

      // 失同步 → 写 OperationLog + 错误日志
      this.logger.error(`对账完成：${result.checked} 行中 ${result.outOfSync.length} 行失同步 ⚠`);
      for (const row of result.outOfSync.slice(0, 10)) {
        this.logger.error(
          `  OP=${row.orderProductId} cached=${row.cached} computed=${row.computed} delta=${row.delta}`
        );
      }
      if (result.outOfSync.length > 10) {
        this.logger.error(`  ...还有 ${result.outOfSync.length - 10} 行未列出`);
      }

      await this.prisma.operationLog.create({
        data: {
          module: 'finance',
          action: 'watchdog',
          target: 'order-product-receivable-out-of-sync',
          details: toJsonValue({
            checked: result.checked,
            outOfSyncCount: result.outOfSync.length,
            // 只存前 50 条避免 details 字段爆炸
            samples: result.outOfSync.slice(0, 50),
          }),
        },
      });

      await this.pushDingtalkAlert(result.checked, result.outOfSync);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`对账失败：${msg}`);
      // cron 内部异常吞掉，避免影响后续调度
    }
  }

  /**
   * 失同步时推钉钉告警。
   *
   * - 未配置 WATCHDOG_ALERT_DINGTALK_USER_IDS → 静默退化（warn 一行即可）
   * - 钉钉调用本身失败 → DingtalkMessengerService 内部 catch；这里再 try/catch
   *   兜底，确保 cron 主流程不会被告警发送 bug 阻塞
   */
  private async pushDingtalkAlert(
    checked: number,
    outOfSync: Array<{ orderProductId: string; cached: unknown; computed: unknown; delta: unknown }>
  ): Promise<void> {
    const userIds = this.parseAlertUserIds();
    if (userIds.length === 0) {
      this.logger.warn(
        'WATCHDOG_ALERT_DINGTALK_USER_IDS 未配置，跳过钉钉告警（仅写 OperationLog）'
      );
      return;
    }

    const samples = outOfSync.slice(0, ALERT_SAMPLE_LIMIT);
    const sampleLines = samples
      .map(
        (r) =>
          `- OP=\`${String(r.orderProductId).slice(0, 8)}..\` ` +
          `cached=${String(r.cached)} computed=${String(r.computed)} delta=${String(r.delta)}`
      )
      .join('\n');
    const overflow =
      outOfSync.length > ALERT_SAMPLE_LIMIT
        ? `\n\n_（仅显示前 ${ALERT_SAMPLE_LIMIT} 条，剩余 ${outOfSync.length - ALERT_SAMPLE_LIMIT} 条见 OperationLog）_`
        : '';
    const markdown =
      `**对账完成：${checked} 行中 ${outOfSync.length} 行失同步 ⚠**\n\n` + sampleLines + overflow;

    try {
      await this.dingtalk.sendActionCardToUsers({
        dingtalkUserIds: userIds,
        title: 'OP.totalReceivedAmount 对账异常',
        markdown,
        singleTitle: '查看 OperationLog',
        singleUrl:
          'http://localhost:5173/operation-logs?target=order-product-receivable-out-of-sync',
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
