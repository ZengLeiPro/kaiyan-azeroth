import { type CloudCostSyncConfig, loadConfig as defaultLoadConfig } from './config';
import type {
  InvocationType,
  RuntimeContext,
  RuntimeEvent,
  RuntimeResponse,
} from './runtime-server';
import { type FullSyncReport, runFullSync as defaultRunFullSync } from './sync/sync-engine';

export interface HandlerDependencies {
  loadConfig: () => CloudCostSyncConfig;
  runFullSync: (config: CloudCostSyncConfig) => Promise<FullSyncReport>;
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
      console.warn('[cloud-cost-sync] 缺少可信 runtime invocation type');
      return internalErrorResponse();
    }

    let config: CloudCostSyncConfig;
    try {
      config = dependencies.loadConfig();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[cloud-cost-sync:${invocationType}] 配置错误:`, message);
      return internalErrorResponse();
    }

    try {
      const report = await dependencies.runFullSync(config);
      const ok = report.errors.length === 0;
      return jsonResponse(ok ? 200 : 207, { success: ok, report });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[cloud-cost-sync:${invocationType}] 同步异常:`, message);
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
