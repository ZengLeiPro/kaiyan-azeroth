import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../common/prisma/prisma.service';
import { DingtalkAuth } from '../dingtalk-core/dingtalk-auth.service';
import { DingtalkHttp } from '../dingtalk-core/dingtalk-http';
import { CalendarApi } from './dingtalk/calendar';
import { LogsApi } from './dingtalk/logs';
import { syncCalendar } from './helpers/calendar-sync.helper';
import { syncLogs } from './helpers/log-sync.helper';

const DEFAULT_API_BASE_URL = 'https://api.dingtalk.com';
const DEFAULT_OAPI_BASE_URL = 'https://oapi.dingtalk.com';

export type ManualSyncResult = {
  entity: string;
  count: number;
  durationMs: number;
};

/**
 * 钉钉手动增量同步 service
 *
 * 由报表页前端按钮触发，仅同步「工作日志」和「日历事件」两个实体。
 * 部门、员工、离职等其他实体不在此模块范围内（历史数据已存量）。
 */
@Injectable()
export class DingtalkSyncService {
  private readonly logger = new Logger(DingtalkSyncService.name);
  private readonly logsApi: LogsApi;
  private readonly calendarApi: CalendarApi;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auth: DingtalkAuth
  ) {
    const oapiBaseUrl = this.config.get<string>('DINGTALK_OAPI_BASE_URL') ?? DEFAULT_OAPI_BASE_URL;
    const apiBaseUrl = this.config.get<string>('DINGTALK_BASE_URL') ?? DEFAULT_API_BASE_URL;
    const requestTimeout = Number(this.config.get<string>('REQUEST_TIMEOUT') ?? 30);
    const maxRetries = Number(this.config.get<string>('MAX_RETRIES') ?? 3);
    const qps = Number(this.config.get<string>('QPS') ?? 30);

    const oapiHttp = new DingtalkHttp({
      baseUrl: oapiBaseUrl,
      timeout: requestTimeout,
      maxRetries,
      qps,
    });

    const apiHttp = new DingtalkHttp({
      baseUrl: apiBaseUrl,
      timeout: requestTimeout,
      maxRetries,
      qps,
    });

    this.logsApi = new LogsApi(oapiHttp, this.auth);
    this.calendarApi = new CalendarApi(apiHttp, this.auth);
  }

  /** 同步工作日志（增量，时间窗口） */
  async runLogsSync(): Promise<ManualSyncResult> {
    const start = Date.now();
    this.logger.log('开始手动同步钉钉工作日志');

    const lookbackDays = Number(this.config.get<string>('LOGS_LOOKBACK_DAYS') ?? 30);
    const overlapHours = Number(this.config.get<string>('INCREMENTAL_OVERLAP_HOURS') ?? 6);

    const result = await syncLogs(this.prisma, this.logsApi, {
      lookbackDays,
      overlapHours,
    });

    const durationMs = Date.now() - start;
    this.logger.log(`工作日志同步完成: ${result.count} 条，耗时 ${durationMs}ms`);

    return { ...result, durationMs };
  }

  /** 同步日历事件（增量，每用户独立 syncToken） */
  async runCalendarSync(): Promise<ManualSyncResult> {
    const start = Date.now();
    this.logger.log('开始手动同步钉钉日历事件');

    const lookbackDays = Number(this.config.get<string>('CALENDAR_LOOKBACK_DAYS') ?? 30);

    const result = await syncCalendar(this.prisma, this.calendarApi, {
      lookbackDays,
    });

    const durationMs = Date.now() - start;
    this.logger.log(`日历事件同步完成: ${result.count} 条，耗时 ${durationMs}ms`);

    return { ...result, durationMs };
  }
}
