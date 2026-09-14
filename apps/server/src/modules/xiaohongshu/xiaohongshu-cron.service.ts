import { XIAOHONGSHU_REPORT_LEVELS } from '@ky-azeroth/shared/constants';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';

import { XiaohongshuService } from './xiaohongshu.service';

@Injectable()
export class XiaohongshuCronService {
  private readonly logger = new Logger(XiaohongshuCronService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly service: XiaohongshuService
  ) {}

  @Cron('*/10 * * * *', { timeZone: 'Asia/Shanghai' })
  async closeStaleRuns(): Promise<void> {
    const count = await this.service.failStaleRuns();
    if (count > 0) this.logger.warn(`已关闭 ${count} 个超时的小红书同步任务`);
  }

  @Cron('0 11 * * *', { timeZone: 'Asia/Shanghai' })
  async handleDailySync(): Promise<void> {
    if (
      this.config.get<string | boolean>('XIAOHONGSHU_SYNC_ENABLED') !== true &&
      this.config.get<string>('XIAOHONGSHU_SYNC_ENABLED') !== 'true'
    ) {
      return;
    }
    const lookback = Math.max(
      1,
      Math.min(30, Number(this.config.get<number | string>('XIAOHONGSHU_SYNC_LOOKBACK_DAYS') ?? 30))
    );
    const end = new Date();
    end.setUTCDate(end.getUTCDate() - 1);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - lookback + 1);
    try {
      const result = await this.service.triggerSync(
        {
          startDate: this.dateString(start),
          endDate: this.dateString(end),
          levels: [...XIAOHONGSHU_REPORT_LEVELS],
        },
        'cron'
      );
      if (result.status === 'failed') {
        this.logger.error(`小红书定时同步失败，任务 ${result.runId} 已记录错误`);
      } else if (result.status === 'partial') {
        this.logger.warn(`小红书定时同步部分成功，任务 ${result.runId} 已记录分片错误`);
      }
    } catch {
      this.logger.error('小红书定时同步启动失败');
    }
  }

  private dateString(value: Date): string {
    return value.toISOString().slice(0, 10);
  }
}
