import { createHash, timingSafeEqual } from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';

export const MAX_REQUEST_BODY_BYTES = 64 * 1024;
export const EVENT_CONTROL_PATH = '/invoke';
export const HTTP_CONTROL_PATH = '/http-invoke';

const CONTROL_PATH_HEADER = 'x-fc-control-path';
const TRIGGER_SECRET_HEADER = 'x-trigger-secret';
const FC_STATUS_HEADER = 'x-fc-status';
const EVENT_FAILURE_STATUS_CODE = 404;
const HEALTH_PATHS = new Set(['/health', '/_health', '/healthz']);
const READINESS_PATHS = new Set(['/ready', '/health/ready']);

export type RuntimeEvent = Record<string, unknown>;
export type InvocationType = 'event' | 'http';

export interface RuntimeContext {
  invocationType: InvocationType;
}

export interface RuntimeResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

export type RuntimeHandler = (
  event: RuntimeEvent,
  context: RuntimeContext
) => Promise<RuntimeResponse>;

export interface RuntimeServerOptions {
  serviceName: string;
  handler: RuntimeHandler;
  triggerSecret: string;
  readiness?: () => Promise<boolean>;
  maxBodyBytes?: number;
}

/**
 * 读取 HTTP trigger 密钥。Custom Runtime 必须在监听端口前完成该检查，避免缺少
 * 密钥时以匿名可执行状态启动。CLI 入口不调用本函数。
 */
export function requireTriggerSecret(
  environmentVariable: string,
  environment: Readonly<Record<string, string | undefined>> = process.env
): string {
  const secret = environment[environmentVariable];
  if (typeof secret !== 'string' || secret.length === 0 || secret.trim().length === 0) {
    throw new Error(`缺少必需的环境变量: ${environmentVariable}`);
  }
  return secret;
}

/**
 * FC Custom Runtime server。
 *
 * FC 自动注入的 x-fc-control-path 是唯一可信调用类型来源：
 * - /invoke：event/timer，允许执行且不要求 HTTP trigger 密钥；
 * - /http-invoke：HTTP trigger，健康检查匿名，其余请求先校验 x-trigger-secret。
 *
 * URL、query、body 以及普通业务 header 均不能声明调用方身份。
 */
export function createRuntimeServer(options: RuntimeServerOptions): http.Server {
  const maxBodyBytes = options.maxBodyBytes ?? MAX_REQUEST_BODY_BYTES;
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes <= 0) {
    throw new Error('maxBodyBytes 必须是正整数');
  }
  if (
    typeof options.triggerSecret !== 'string' ||
    options.triggerSecret.length === 0 ||
    options.triggerSecret.trim().length === 0
  ) {
    throw new Error('HTTP trigger secret 未配置');
  }

  return http.createServer((req, res) => {
    handleRequest(req, res, options, maxBodyBytes);
  });
}

function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: RuntimeServerOptions,
  maxBodyBytes: number
): void {
  const requestPath = (req.url ?? '/').split('?', 1)[0] ?? '/';

  if (req.method === 'GET' && READINESS_PATHS.has(requestPath)) {
    void (options.readiness?.() ?? Promise.resolve(false))
      .then((ready) => {
        rejectWithoutReadingBody(
          req,
          res,
          ready ? 200 : 503,
          ready ? 'ready' : 'not ready',
          {},
          {
            status: ready ? 'ready' : 'not_ready',
            service: options.serviceName,
            releaseSha: process.env.RELEASE_SHA || 'unknown',
          }
        );
      })
      .catch(() => {
        rejectWithoutReadingBody(
          req,
          res,
          503,
          'not ready',
          {},
          {
            status: 'not_ready',
            service: options.serviceName,
            releaseSha: process.env.RELEASE_SHA || 'unknown',
          }
        );
      });
    return;
  }

  // HTTP trigger 的健康探针不依赖 FC 内部控制头；公网网关可能不向应用暴露该头。
  if (req.method === 'GET' && HEALTH_PATHS.has(requestPath)) {
    rejectWithoutReadingBody(
      req,
      res,
      200,
      'ok',
      {},
      {
        status: 'ok',
        service: options.serviceName,
        releaseSha: process.env.RELEASE_SHA || 'unknown',
      }
    );
    return;
  }

  const invocationType = getInvocationType(req);
  if (!invocationType) {
    rejectWithoutReadingBody(req, res, 400, 'bad request');
    return;
  }

  if (invocationType === 'http' && HEALTH_PATHS.has(requestPath)) {
    rejectWithoutReadingBody(req, res, 405, 'method not allowed', { Allow: 'GET' });
    return;
  }

  if (invocationType === 'http') {
    // 授权必须发生在注册 data/end 监听器之前；query/body 中的 secret 永远无效。
    if (!hasValidTriggerSecret(req, options.triggerSecret)) {
      rejectWithoutReadingBody(req, res, 401, 'unauthorized');
      return;
    }
    if (req.method !== 'POST') {
      rejectWithoutReadingBody(req, res, 405, 'method not allowed', { Allow: 'POST' });
      return;
    }
  } else if (req.method !== 'POST') {
    rejectWithoutReadingBody(req, res, 405, 'method not allowed', {
      Allow: 'POST',
      [FC_STATUS_HEADER]: String(EVENT_FAILURE_STATUS_CODE),
    });
    return;
  }

  readJsonObjectBody(req, res, maxBodyBytes, invocationType, (event) => {
    void options
      .handler(event, { invocationType })
      .then((result) => {
        writeHandlerResult(res, invocationType, result);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[${options.serviceName}] handler 异常:`, message);
        writeInvocationError(res, invocationType, 500, 'internal error');
      });
  });
}

function getInvocationType(req: IncomingMessage): InvocationType | null {
  const controlPath = req.headers[CONTROL_PATH_HEADER];
  if (controlPath === EVENT_CONTROL_PATH) return 'event';
  if (controlPath === HTTP_CONTROL_PATH) return 'http';
  return null;
}

function hasValidTriggerSecret(req: IncomingMessage, expected: string): boolean {
  const provided = req.headers[TRIGGER_SECRET_HEADER];
  if (typeof provided !== 'string' || provided.length === 0) return false;

  // 固定长度摘要避免 timingSafeEqual 的等长前置条件泄露密钥长度比较分支。
  const expectedDigest = createHash('sha256').update(expected, 'utf8').digest();
  const providedDigest = createHash('sha256').update(provided, 'utf8').digest();
  return timingSafeEqual(expectedDigest, providedDigest);
}

function readJsonObjectBody(
  req: IncomingMessage,
  res: ServerResponse,
  maxBodyBytes: number,
  invocationType: InvocationType,
  onBody: (event: RuntimeEvent) => void
): void {
  const declaredLength = req.headers['content-length'];
  if (declaredLength !== undefined) {
    if (!/^\d+$/.test(declaredLength)) {
      rejectInvocationWithoutReadingBody(req, res, invocationType, 400, 'bad request');
      return;
    }
    if (BigInt(declaredLength) > BigInt(maxBodyBytes)) {
      rejectInvocationWithoutReadingBody(req, res, invocationType, 413, 'request body too large');
      return;
    }
  }

  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  let rejected = false;

  req.on('data', (chunk: Buffer) => {
    if (rejected) return;

    receivedBytes += chunk.length;
    if (receivedBytes > maxBodyBytes) {
      rejected = true;
      chunks.length = 0;
      writeInvocationError(res, invocationType, 413, 'request body too large');
      return;
    }
    chunks.push(chunk);
  });

  req.on('end', () => {
    if (rejected || res.writableEnded) return;

    if (receivedBytes === 0) {
      onBody({});
      return;
    }

    try {
      const parsed: unknown = JSON.parse(Buffer.concat(chunks, receivedBytes).toString('utf8'));
      if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
        writeInvocationError(res, invocationType, 400, 'bad request');
        return;
      }
      onBody(parsed as RuntimeEvent);
    } catch {
      writeInvocationError(res, invocationType, 400, 'bad request');
    }
  });

  req.on('aborted', () => {
    if (res.writableEnded) return;
    rejected = true;
    chunks.length = 0;
    writeInvocationError(res, invocationType, 400, 'bad request');
  });

  req.on('error', (err: Error) => {
    if (res.writableEnded) return;
    rejected = true;
    chunks.length = 0;
    console.warn('[runtime] 请求读取失败:', err.message);
    writeInvocationError(res, invocationType, 400, 'bad request');
  });
}

function rejectInvocationWithoutReadingBody(
  req: IncomingMessage,
  res: ServerResponse,
  invocationType: InvocationType,
  statusCode: number,
  error: string
): void {
  req.resume();
  writeInvocationError(res, invocationType, statusCode, error);
}

function rejectWithoutReadingBody(
  req: IncomingMessage,
  res: ServerResponse,
  statusCode: number,
  error: string,
  headers: Record<string, string> = {},
  successBody?: unknown
): void {
  req.resume();
  writeJson(res, statusCode, successBody ?? { success: false, error }, headers);
}

/**
 * InvokeFunction 会忽略普通 HTTP status/header；只有 x-fc-status 能让 FC 识别
 * Custom Runtime 调用失败。event 仅把 handler 的精确 200 视为完全成功，其余
 * 结果统一映射到官方支持的失败码 404，同时原样保留 handler JSON body。
 */
function writeHandlerResult(
  res: ServerResponse,
  invocationType: InvocationType,
  result: RuntimeResponse
): void {
  const headers = withoutFcStatusHeader(result.headers);
  if (invocationType === 'event') {
    const statusCode = result.statusCode === 200 ? 200 : EVENT_FAILURE_STATUS_CODE;
    writeResponseBody(res, statusCode, result.body, {
      ...headers,
      [FC_STATUS_HEADER]: String(statusCode),
    });
    return;
  }

  // x-fc-status 仅属于 FC event 控制面，HTTP 手动调用保留普通状态码语义。
  writeResponseBody(res, result.statusCode, result.body, headers);
}

function writeInvocationError(
  res: ServerResponse,
  invocationType: InvocationType,
  httpStatusCode: number,
  error: string
): void {
  if (invocationType === 'event') {
    writeJson(
      res,
      EVENT_FAILURE_STATUS_CODE,
      { success: false, error },
      { [FC_STATUS_HEADER]: String(EVENT_FAILURE_STATUS_CODE) }
    );
    return;
  }
  writeJson(res, httpStatusCode, { success: false, error });
}

function withoutFcStatusHeader(
  headers: Record<string, string> | undefined
): Record<string, string> {
  if (!headers) return {};
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => name.toLowerCase() !== FC_STATUS_HEADER)
  );
}

function writeResponseBody(
  res: ServerResponse,
  statusCode: number,
  body: string,
  headers: Record<string, string> = {}
): void {
  if (res.writableEnded) return;
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function writeJson(
  res: ServerResponse,
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {}
): void {
  writeResponseBody(res, statusCode, JSON.stringify(body), headers);
}
