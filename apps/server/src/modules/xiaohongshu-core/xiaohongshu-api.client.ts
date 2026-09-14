import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance } from 'axios';

import {
  XiaohongshuApiEnvelope,
  XiaohongshuNoteListData,
  XiaohongshuNoteListRequest,
  XiaohongshuOAuthData,
  XiaohongshuOfflineReportData,
  XiaohongshuOfflineReportRequest,
  XiaohongshuReportLevel,
  XiaohongshuReportRow,
} from './xiaohongshu.types';

const DEFAULT_BASE_URL = 'https://adapi.xiaohongshu.com';
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_REPORT_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1_000;
const RETRYABLE_BUSINESS_CODE = 410029;

export class XiaohongshuApiError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly requestId?: string,
    readonly httpStatus?: number
  ) {
    super(message);
    this.name = 'XiaohongshuApiError';
  }
}

export interface XiaohongshuReadResponse<T = unknown> {
  data: T;
  requestId?: string;
}

@Injectable()
export class XiaohongshuApiClient {
  private readonly client: AxiosInstance;

  constructor(configService: ConfigService) {
    this.client = axios.create({
      baseURL: configService.get<string>('XIAOHONGSHU_API_BASE_URL') ?? DEFAULT_BASE_URL,
      timeout: DEFAULT_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async exchangeAuthCode(
    appId: string,
    secret: string,
    authCode: string
  ): Promise<XiaohongshuOAuthData> {
    return this.postToken('/api/open/oauth2/access_token', {
      app_id: appId,
      secret,
      auth_code: authCode,
    });
  }

  async refreshToken(
    appId: string,
    secret: string,
    refreshToken: string
  ): Promise<XiaohongshuOAuthData> {
    return this.postToken('/api/open/oauth2/refresh_token', {
      app_id: appId,
      secret,
      refresh_token: refreshToken,
    });
  }

  async fetchOfflineReport<TRow extends XiaohongshuReportRow = XiaohongshuReportRow>(
    accessToken: string,
    level: XiaohongshuReportLevel,
    request: XiaohongshuOfflineReportRequest
  ): Promise<XiaohongshuOfflineReportData<TRow>> {
    return this.postWithReportRetry(
      `/api/open/jg/data/report/offline/${level}`,
      request,
      accessToken
    );
  }

  async fetchNoteList(
    accessToken: string,
    request: XiaohongshuNoteListRequest
  ): Promise<XiaohongshuNoteListData> {
    return this.postWithReportRetry('/api/open/jg/note/list', request, accessToken);
  }

  /** 调用 registry 白名单中的官方只读接口，并保留 request_id 供数据目录诊断。 */
  async fetchReadData<T = unknown>(
    accessToken: string,
    path: string,
    method: 'GET' | 'POST',
    request: object
  ): Promise<XiaohongshuReadResponse<T>> {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await this.client.request<XiaohongshuApiEnvelope<T>>({
          url: path,
          method,
          ...(method === 'GET' ? { params: request } : { data: request }),
          headers: { 'Access-Token': accessToken },
        });
        const envelope = response.data;
        return {
          data: this.unwrapRead(envelope),
          ...(typeof envelope.request_id === 'string' ? { requestId: envelope.request_id } : {}),
        };
      } catch (error: unknown) {
        const sanitized = this.toApiError(error);
        if (attempt >= MAX_REPORT_RETRIES || !this.isRetryable(error, sanitized)) {
          throw sanitized;
        }
        await this.sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
      }
    }
  }

  private async postWithReportRetry<T>(
    path: string,
    request: object,
    accessToken: string
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await this.client.post<XiaohongshuApiEnvelope<T>>(path, request, {
          headers: { 'Access-Token': accessToken },
        });
        return this.unwrap(response.data);
      } catch (error: unknown) {
        const sanitized = this.toApiError(error);
        if (attempt >= MAX_REPORT_RETRIES || !this.isRetryable(error, sanitized)) {
          throw sanitized;
        }
        await this.sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
      }
    }
  }

  private async postToken(
    path: string,
    request: Record<string, string>
  ): Promise<XiaohongshuOAuthData> {
    try {
      const response = await this.client.post<XiaohongshuApiEnvelope<XiaohongshuOAuthData>>(
        path,
        request
      );
      return this.unwrap(response.data);
    } catch (error: unknown) {
      throw this.toApiError(error);
    }
  }

  private unwrap<T>(envelope: XiaohongshuApiEnvelope<T>): T {
    if (
      typeof envelope !== 'object' ||
      envelope === null ||
      envelope.success !== true ||
      envelope.code !== 0 ||
      !('data' in envelope)
    ) {
      const value = envelope as Partial<XiaohongshuApiEnvelope<T>>;
      throw new XiaohongshuApiError(
        'Xiaohongshu API returned an unsuccessful response',
        typeof value.code === 'number' ? value.code : undefined,
        typeof value.request_id === 'string' ? value.request_id : undefined
      );
    }
    return envelope.data;
  }

  private unwrapRead<T>(envelope: XiaohongshuApiEnvelope<T>): T {
    if (
      typeof envelope !== 'object' ||
      envelope === null ||
      envelope.success !== true ||
      envelope.code !== 0
    ) {
      const value = envelope as Partial<XiaohongshuApiEnvelope<T>>;
      throw new XiaohongshuApiError(
        'Xiaohongshu API returned an unsuccessful response',
        typeof value.code === 'number' ? value.code : undefined,
        typeof value.request_id === 'string' ? value.request_id : undefined
      );
    }
    if ('data' in envelope) return envelope.data;

    const rootPayload = Object.fromEntries(
      Object.entries(envelope).filter(
        ([key]) => !['code', 'success', 'msg', 'request_id'].includes(key)
      )
    );
    return rootPayload as T;
  }

  private toApiError(error: unknown): XiaohongshuApiError {
    if (error instanceof XiaohongshuApiError) return error;

    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<Partial<XiaohongshuApiEnvelope<unknown>>>;
      const responseData = axiosError.response?.data;
      return new XiaohongshuApiError(
        'Xiaohongshu API request failed',
        typeof responseData?.code === 'number' ? responseData.code : undefined,
        typeof responseData?.request_id === 'string' ? responseData.request_id : undefined,
        axiosError.response?.status
      );
    }

    return new XiaohongshuApiError('Xiaohongshu API request failed');
  }

  private isRetryable(error: unknown, apiError: XiaohongshuApiError): boolean {
    if (apiError.code === RETRYABLE_BUSINESS_CODE) return true;
    if (!axios.isAxiosError(error)) return false;

    const status = error.response?.status;
    return (
      error.code === 'ECONNABORTED' ||
      error.code === 'ETIMEDOUT' ||
      (typeof status === 'number' && (status === 429 || status >= 500))
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
