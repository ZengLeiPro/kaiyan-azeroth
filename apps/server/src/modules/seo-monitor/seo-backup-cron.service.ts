import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { SeoMonitorService } from './seo-monitor.service';

/**
 * SEO 每日同步 cron 兜底服务（07-04 已确认 方案 B）。
 *
 * 背景：独立同步应用可自带定时触发器，但进程重启后下一 tick 可能哑火。
 *
 * 兜底策略：本服务进程内置 cron，每天 09:00 调用已配置的同步 HTTP 入口；
 * 未配置同步 URL 时不发请求。走 secret 校验后跑同一个 `runFullSync`。
 *
 * 幂等性：FC 端每次跑都写 SeoSyncRun 一行、按 (statDate, source, siteUrl,
 * query|pageUrl) upsert 数据行——即使 FC timer 那天恰好也响了、azeroth cron 又跑一次
 * 也不会产生重复数据，最多多一条 sync-run 审计记录，成本可接受。
 *
 * 错误吞回：cron 任务不允许把异常抛到 NestJS scheduler（否则日志噪音、且
 * 后续 tick 可能被跳过）。fetch 层的 502/504 网关异常全部 catch，
 * 只 logger.error 不冒出。
 *
 * DB 上的 `triggerSource` 会记为 `'http'`（FC handler 逻辑），要区分 cron 兜底
 * vs 前端手动同步，看触发时间：每天 09:00-09:05 CST 出现的 http 记录即本 cron。
 */
@Injectable()
export class SeoBackupCronService {
  private readonly logger = new Logger(SeoBackupCronService.name);

  constructor(private readonly seoMonitor: SeoMonitorService) {}

  /**
   * 每天 09:00 CST 触发一次 FC 全量同步（兜底 FC daily-sync timer 失效）。
   *
   * cron 表达式解析（`@nestjs/schedule` 用 cron 语法，最小粒度分钟）：
   *   `0 9 * * *` + `timeZone: 'Asia/Shanghai'` == 每天北京时间 09:00:00 触发
   *
   * FC 端 daily-sync timer 若正常触发是 09:00:00 CST；本 cron 与它同点位跑，
   * 只在 timer 哑火时补齐当天数据。同时跑一次的成本约几十秒 FC 计费 + 一行
   * sync-run 记录，可接受。
   */
  @Cron('0 9 * * *', { timeZone: 'Asia/Shanghai' })
  async handleDailyBackup(): Promise<void> {
    this.logger.log('SEO daily-sync 兜底 cron 触发（09:00 CST）');
    try {
      const result = await this.seoMonitor.triggerAutomaticBackup();
      if (result.errorCount > 0) {
        this.logger.warn(
          `SEO 兜底同步部分失败: 合计写入 ${result.count} 条（Bing ${result.bingWritten} + Clarity ${result.clarityWritten}），FC 耗时 ${result.durationMs}ms，错误 ${result.errorCount}`
        );
      } else {
        this.logger.log(
          `SEO 兜底同步完成: 合计写入 ${result.count} 条（Bing ${result.bingWritten} + Clarity ${result.clarityWritten}），FC 耗时 ${result.durationMs}ms，错误 0`
        );
      }
    } catch {
      // 不回显下层异常，避免 FC URL query、secret 或底层 Abort 文本进入 cron 日志。
      this.logger.error('SEO 兜底同步失败（不影响下次 tick）');
    }
  }
}
