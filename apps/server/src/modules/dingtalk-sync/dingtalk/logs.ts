import { DingtalkAuth } from '../../dingtalk-core/dingtalk-auth.service';
import { DingtalkHttp } from '../../dingtalk-core/dingtalk-http';
import { normalizeText } from '../utils';

type TopApiResponse<T> = {
  errcode?: number;
  errmsg?: string;
  result?: T;
};

type ReportListResult = {
  data_list?: Array<Record<string, unknown>>;
  has_more?: boolean;
  next_cursor?: number;
  hasMore?: boolean;
  nextCursor?: number;
};

export type DingtalkLogRaw = {
  reportId: string;
  templateName: string;
  creatorId: string;
  creatorName: string;
  deptName: string;
  createTime: Date | null;
  contents: string;
};

/**
 * 钉钉日报 API
 *
 * 迁移自 apps/dingtalk-sync/src/dingtalk/logs.ts，保持纯 class。
 */
export class LogsApi {
  constructor(
    private readonly http: DingtalkHttp,
    private readonly auth: DingtalkAuth
  ) {}

  /** 获取部门的工作日志列表 */
  async getDepartmentLogs(
    deptId: number,
    startTimeMs: number,
    endTimeMs: number
  ): Promise<DingtalkLogRaw[]> {
    const logs: DingtalkLogRaw[] = [];
    const size = 100;
    let cursor = 0;
    let pages = 0;

    while (true) {
      pages += 1;
      if (pages > 1000) {
        throw new Error(`获取部门日志分页超过上限（deptId=${deptId}），可能陷入循环`);
      }

      const data = await this.postTop<ReportListResult>('/topapi/report/list', {
        dept_id: deptId,
        start_time: startTimeMs,
        end_time: endTimeMs,
        cursor,
        size,
      });

      const result = data.result ?? {};
      const list = Array.isArray(result.data_list) ? result.data_list : [];

      for (const item of list) {
        const contents = Array.isArray(item?.contents)
          ? (item.contents as Array<Record<string, unknown>>)
          : [];
        let contentText = '';
        for (const c of contents) {
          const key = normalizeText(c?.key);
          const value = normalizeText(c?.value);
          if (value) contentText += `${key}: ${value}\n`;
        }

        const createTimeMs = item?.create_time;
        let createTime: Date | null = null;
        if (typeof createTimeMs === 'number' && Number.isFinite(createTimeMs) && createTimeMs > 0) {
          createTime = new Date(createTimeMs);
        }

        logs.push({
          reportId: normalizeText(item?.report_id),
          templateName: normalizeText(item?.template_name) || '日报',
          creatorId: normalizeText(item?.creator_id),
          creatorName: normalizeText(item?.creator_name),
          deptName: normalizeText(item?.dept_name),
          createTime,
          contents: contentText.trim(),
        });
      }

      const hasMore = Boolean(result.has_more ?? result.hasMore ?? false);
      const nextCursorRaw = result.next_cursor ?? result.nextCursor;
      const nextCursor =
        typeof nextCursorRaw === 'number' ? nextCursorRaw : Number(nextCursorRaw ?? NaN);

      if (!hasMore) break;
      if (!Number.isFinite(nextCursor) || nextCursor === cursor) break;
      cursor = nextCursor;
    }

    console.log(`获取部门(${deptId})日志成功，共 ${logs.length} 条，共 ${pages} 页`);
    return logs;
  }

  private async postTop<T>(url: string, body: Record<string, unknown>): Promise<TopApiResponse<T>> {
    const accessToken = await this.auth.getAccessToken();
    const data = await this.http.post<TopApiResponse<T>>(url, body, {
      params: { access_token: accessToken },
    });

    if ((data.errcode ?? 0) !== 0) {
      throw new Error(`调用${url}失败: ${data.errmsg ?? data.errcode}`);
    }

    return data;
  }
}
