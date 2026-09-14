import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DingtalkAuth } from '../dingtalk-core/dingtalk-auth.service';
import { DingtalkHttp } from '../dingtalk-core/dingtalk-http';

const DEFAULT_API_BASE_URL = 'https://api.dingtalk.com';
const DINGTALK_HTTP_STATUS_TOKEN_INVALID = 401;

interface TodoDetailUrl {
  pcUrl: string;
  appUrl: string;
}

interface DingtalkTodoTaskResponse {
  id?: string;
  subject?: string;
  description?: string;
  done?: boolean;
  executorIds?: string[];
  participantIds?: string[];
  detailUrl?: TodoDetailUrl;
  sourceId?: string;
  createdTime?: number;
  requestId?: string;
}

export interface CreateDingtalkTodoParams {
  /** 创建者 unionId；path 中 users/{unionId} 也使用它 */
  creatorUnionId: string;
  /** 业务侧唯一 ID，建议形如 azeroth:approval-task:{taskId} */
  sourceId: string;
  subject: string;
  description: string;
  executorUnionIds: string[];
  detailUrl: TodoDetailUrl;
}

export interface CompleteDingtalkTodoParams {
  creatorUnionId: string;
  taskId: string;
  subject: string;
  description: string;
  executorUnionIds: string[];
  participantUnionIds?: string[];
}

/**
 * 钉钉待办任务服务。
 *
 * 使用新版 OpenAPI：
 * - POST /v1.0/todo/users/{unionId}/tasks 创建工作待办
 * - PUT  /v1.0/todo/users/{unionId}/tasks/{taskId} 标记完成
 *
 * 失败语义：对调用方不抛出，统一 warn 并返回 null/false，避免钉钉侧波动阻断审批主流程。
 */
@Injectable()
export class DingtalkTodoService {
  private readonly logger = new Logger(DingtalkTodoService.name);
  private readonly http: DingtalkHttp;

  constructor(
    private readonly config: ConfigService,
    private readonly auth: DingtalkAuth
  ) {
    const apiBaseUrl = this.config.get<string>('DINGTALK_API_BASE_URL') ?? DEFAULT_API_BASE_URL;
    this.http = new DingtalkHttp({
      baseUrl: apiBaseUrl,
      timeout: 30,
      maxRetries: 3,
      qps: 20,
    });
  }

  async createTask(params: CreateDingtalkTodoParams): Promise<DingtalkTodoTaskResponse | null> {
    const executorIds = unique(params.executorUnionIds);
    if (!params.creatorUnionId || executorIds.length === 0) return null;

    const body = {
      sourceId: params.sourceId,
      subject: truncate(params.subject, 1024),
      creatorId: params.creatorUnionId,
      description: truncate(params.description, 4096),
      executorIds,
      participantIds: [],
      detailUrl: params.detailUrl,
      isOnlyShowExecutor: true,
      priority: 20,
    };

    return this.withTokenRetry('创建钉钉待办', async (token) => {
      const resp = await this.http.post<DingtalkTodoTaskResponse>(
        `/v1.0/todo/users/${encodeURIComponent(params.creatorUnionId)}/tasks`,
        body,
        {
          params: { operatorId: params.creatorUnionId },
          headers: { 'x-acs-dingtalk-access-token': token },
        }
      );
      this.logger.log(`钉钉待办已创建 taskId=${resp?.id} sourceId=${params.sourceId}`);
      return resp;
    });
  }

  async completeTask(params: CompleteDingtalkTodoParams): Promise<boolean> {
    const executorIds = unique(params.executorUnionIds);
    if (!params.creatorUnionId || !params.taskId || executorIds.length === 0) return false;

    const body = {
      subject: truncate(params.subject, 1024),
      description: truncate(params.description, 4096),
      executorIds,
      participantIds: unique(params.participantUnionIds ?? []),
      done: true,
    };

    const resp = await this.withTokenRetry('完成钉钉待办', async (token) => {
      return this.http.put<{ result?: boolean }>(
        `/v1.0/todo/users/${encodeURIComponent(params.creatorUnionId)}/tasks/${encodeURIComponent(
          params.taskId
        )}`,
        body,
        {
          params: { operatorId: params.creatorUnionId },
          headers: { 'x-acs-dingtalk-access-token': token },
        }
      );
    });

    const ok = resp?.result === true;
    if (ok) this.logger.log(`钉钉待办已完成 taskId=${params.taskId}`);
    return ok;
  }

  private async withTokenRetry<T>(
    label: string,
    fn: (token: string) => Promise<T>
  ): Promise<T | null> {
    try {
      const firstToken = await this.auth.getAccessToken();
      return await fn(firstToken);
    } catch (err) {
      if (!isTokenInvalidError(err)) {
        this.logger.warn(`${label}失败: ${formatError(err)}`);
        return null;
      }

      this.logger.warn(`${label} access_token 失效，invalidate 后重试一次`);
      this.auth.invalidate();
      try {
        const retryToken = await this.auth.getAccessToken();
        return await fn(retryToken);
      } catch (retryErr) {
        this.logger.warn(`${label}重试失败: ${formatError(retryErr)}`);
        return null;
      }
    }
  }
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max - 1) + '…';
}

function isTokenInvalidError(err: unknown): boolean {
  const e = err as { response?: { status?: number; data?: { code?: string; message?: string } } };
  if (e?.response?.status === DINGTALK_HTTP_STATUS_TOKEN_INVALID) return true;
  const code = e?.response?.data?.code;
  return code === 'InvalidAuthentication' || code === 'InvalidAccessToken';
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
