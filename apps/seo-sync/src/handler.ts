import { loadConfig as defaultLoadConfig, type SeoSyncConfig } from './config';
import type {
  InvocationType,
  RuntimeContext,
  RuntimeEvent,
  RuntimeResponse,
} from './runtime-server';
import { runFullSync as defaultRunFullSync, type SeoSyncReport } from './sync/sync-engine';

export interface HandlerDependencies {
  loadConfig: () => SeoSyncConfig;
  runFullSync: (config: SeoSyncConfig, triggerSource: string) => Promise<SeoSyncReport>;
}

const defaultDependencies: HandlerDependencies = {
  loadConfig: () => defaultLoadConfig(),
  runFullSync: defaultRunFullSync,
};

/**
 * 创建同步 handler。调用类型只读取 runtime server 构造的 context；event 是纯业务
 * payload，source/action/secret/header/query 均不能授权或改变调用类型。
 */
export function createHandler(dependencies: HandlerDependencies = defaultDependencies) {
  return async function syncHandler(
    _event: RuntimeEvent,
    context: RuntimeContext
  ): Promise<RuntimeResponse> {
    const invocationType = readInvocationType(context);
    if (!invocationType) {
      console.warn('[seo-sync] 缺少可信 runtime invocation type');
      return internalErrorResponse();
    }

    let config: SeoSyncConfig;
    try {
      config = dependencies.loadConfig();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[seo-sync:${invocationType}] 配置错误:`, message);
      return internalErrorResponse();
    }

    try {
      const triggerSource = invocationType === 'event' ? 'timer' : 'http';
      const report = await dependencies.runFullSync(config, triggerSource);
      const ok = report.errors.length === 0;
      // FC timer 已经成功跑完并持久化 report 时，即使单个数据源部分失败也要 ACK 200；
      // 否则 Custom Runtime 会把 207 映射为失败并自动重试，造成同一轮重复同步。
      // 手动 HTTP 调用仍保留 207，让调用方明确看到部分失败。
      const statusCode = invocationType === 'event' ? 200 : ok ? 200 : 207;
      return jsonResponse(statusCode, { success: ok, report });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[seo-sync:${invocationType}] 同步异常:`, message);
      return internalErrorResponse();
    }
  };
}

export const handler = createHandler();

function readInvocationType(context: RuntimeContext): InvocationType | null {
  const invocationType: unknown = context?.invocationType;
  return invocationType === 'event' || invocationType === 'http' ? invocationType : null;
}

function internalErrorResponse(): RuntimeResponse {
  return jsonResponse(500, { success: false, error: 'internal error' });
}

function jsonResponse(statusCode: number, body: unknown): RuntimeResponse {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
