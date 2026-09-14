import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GlobalExceptionFilter,
  sanitizeDiagnosticString,
  sanitizeDiagnosticValue,
} from './global-exception.filter';

type JsonBody = Record<string, unknown>;

function createHost(
  url = '/api/v1/test',
  overrides: Partial<Request> & {
    diagnosticContext?: { traceId: string; startedAt: number };
    user?: Record<string, unknown>;
  } = {}
) {
  const json = vi.fn<(body: JsonBody) => Response>();
  const status = vi.fn<(code: number) => Response>();
  const request = {
    method: 'GET',
    url,
    headers: { 'x-request-id': 'spoofed-trace' },
    route: { path: url.split('?')[0] },
    diagnosticContext: { traceId: 'trace-1', startedAt: Date.now() },
    ...overrides,
  } as unknown as Request;
  const response = {
    status,
    json,
  } as Pick<Response, 'status' | 'json'>;
  status.mockImplementation(() => response as Response);
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as ArgumentsHost;

  return { host, request, status, json };
}

function createPrismaError(
  code: string,
  message: string,
  meta?: Record<string, unknown>
): PrismaClientKnownRequestError {
  return new PrismaClientKnownRequestError(message, {
    code,
    clientVersion: 'test',
    ...(meta ? { meta } : {}),
  });
}

describe('GlobalExceptionFilter', () => {
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('统一序列化 HttpException，保持既有 4xx 策略', () => {
    const filter = new GlobalExceptionFilter();
    const { host, status, json } = createHost();

    filter.catch(new BadRequestException(['字段错误']), host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: ['字段错误'],
        code: 'Bad Request',
        traceId: 'trace-1',
        path: '/api/v1/test',
      })
    );
  });

  it('4xx 日志脱敏 code/message，响应保持原消息且路径只使用路由模板', () => {
    const filter = new GlobalExceptionFilter();
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { host, json } = createHost(
      '/api/v1/reset/raw-path-secret?auth_code=query-secret&state=secret-state',
      { route: { path: '/api/v1/reset/:token' } }
    );

    filter.catch(
      new HttpException(
        { message: '校验失败 token=message-secret', code: 'AUTH_secret=code-secret' },
        HttpStatus.BAD_REQUEST
      ),
      host
    );

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/api/v1/reset/:token',
        message: '校验失败 token=message-secret',
        code: 'AUTH_secret=code-secret',
      })
    );
    expect(JSON.stringify(json.mock.calls)).not.toMatch(
      /raw-path-secret|query-secret|secret-state/
    );
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(
      /raw-path-secret|query-secret|secret-state|message-secret|code-secret/
    );
  });

  it('路由模板不可用时使用安全占位而不回退原始 path', () => {
    const filter = new GlobalExceptionFilter();
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { host, json } = createHost('/download/path-secret', { route: undefined });

    filter.catch(new BadRequestException('失败'), host);

    expect(json).toHaveBeenCalledWith(expect.objectContaining({ path: '[unmatched-route]' }));
    expect(JSON.stringify(json.mock.calls)).not.toContain('path-secret');
  });

  it('映射 Prisma 唯一约束错误为 409', () => {
    const filter = new GlobalExceptionFilter();
    const { host, status, json } = createHost();
    const error = createPrismaError('P2002', 'Unique constraint failed', {
      target: ['email'],
    });

    filter.catch(error, host);

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 409,
        message: '数据已存在，请检查唯一字段',
        code: 'PRISMA_UNIQUE_CONSTRAINT',
      })
    );
  });

  it('映射 Prisma 记录不存在错误为 404', () => {
    const filter = new GlobalExceptionFilter();
    const { host, status, json } = createHost();
    const error = createPrismaError('P2025', 'Record not found');

    filter.catch(error, host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        message: '数据不存在或已被删除',
        code: 'PRISMA_RECORD_NOT_FOUND',
      })
    );
  });

  it('映射 Prisma 外键约束错误为 400', () => {
    const filter = new GlobalExceptionFilter();
    const { host, status, json } = createHost();
    const error = createPrismaError('P2003', 'Foreign key constraint failed', {
      field_name: 'customerId',
    });

    filter.catch(error, host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: '关联数据不存在或不允许删除',
        code: 'PRISMA_FOREIGN_KEY_CONSTRAINT',
      })
    );
  });

  it('拒绝仅伪造 name/code 的 Prisma 错误', () => {
    const filter = new GlobalExceptionFilter();
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { host, status, json } = createHost();
    const forged = Object.assign(new Error('forged'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
      clientVersion: 'test',
    });

    filter.catch(forged, host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'INTERNAL_SERVER_ERROR', message: '服务器内部错误' })
    );
  });

  it('500 响应固定安全文案，仅通过 traceId 与结构化诊断关联', () => {
    const filter = new GlobalExceptionFilter();
    const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { host, json } = createHost('/api/v1/payments?token=response-secret', {
      method: 'POST',
      diagnosticContext: { traceId: 'trace-server-500', startedAt: Date.now() - 42 },
      user: { id: 'stable-user-id', username: 'private-name', authorization: 'Bearer private' },
    });
    const cause = new Error('upstream password=hunter2');
    cause.stack = 'cause stack https://example.test/path?token=cause-secret';
    const error = new Error('failed authorization=Bearer top-secret', { cause });
    error.stack = 'Error: token=stack-secret\n at https://example.test/x?secret=url-secret';

    filter.catch(error, host);

    const body = json.mock.calls[0]?.[0];
    expect(body).toEqual(
      expect.objectContaining({
        statusCode: 500,
        message: '服务器内部错误',
        code: 'INTERNAL_SERVER_ERROR',
        traceId: 'trace-server-500',
        path: '/api/v1/payments',
      })
    );
    expect(body).not.toHaveProperty('details');

    const diagnostic = errorLog.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(diagnostic).toEqual(
      expect.objectContaining({
        type: 'server_error',
        traceId: 'trace-server-500',
        method: 'POST',
        path: '/api/v1/payments',
        userId: 'stable-user-id',
        latencyMs: expect.any(Number),
        error: expect.objectContaining({ name: 'Error', stack: expect.any(String) }),
      })
    );
    const serializedDiagnostic = JSON.stringify(diagnostic);
    expect(serializedDiagnostic).toContain('[REDACTED]');
    expect(serializedDiagnostic).not.toMatch(
      /response-secret|private-name|top-secret|hunter2|stack-secret|cause-secret|url-secret/
    );
  });

  it('异常对象含抛错 getter 或 revoked Proxy 时仍返回安全 500', () => {
    const filter = new GlobalExceptionFilter();
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { host, status, json } = createHost();
    const error = new Error('original');
    Object.defineProperty(error, 'stack', {
      get() {
        throw new Error('stack-getter-secret');
      },
    });
    const { proxy, revoke } = Proxy.revocable(error, {});
    revoke();

    expect(() => filter.catch(proxy, host)).not.toThrow();
    expect(status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(json.mock.calls)).not.toContain('stack-getter-secret');
  });

  it('HttpException 500 也不向客户端泄露业务消息、stack 或 cause', () => {
    process.env.NODE_ENV = 'development';
    const filter = new GlobalExceptionFilter();
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { host, json } = createHost();
    const error = new HttpException(
      { message: '数据库 password=db-secret', code: 'PRIVATE_DB_FAILURE' },
      HttpStatus.INTERNAL_SERVER_ERROR
    );

    filter.catch(error, host);

    const serialized = JSON.stringify(json.mock.calls[0]?.[0]);
    expect(serialized).not.toMatch(/db-secret|PRIVATE_DB_FAILURE|stack|cause/);
    expect(json.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        message: '服务器内部错误',
        code: 'INTERNAL_SERVER_ERROR',
        traceId: 'trace-1',
      })
    );
  });
});

describe('diagnostic sanitization', () => {
  it('递归脱敏敏感字段、URL query、Bearer/JWT 并处理 cause 和循环引用', () => {
    const cyclic: Record<string, unknown> = {
      password: 'pw-secret',
      nested: {
        authorization: 'Bearer auth-secret',
        url: 'https://example.test/callback?code=query-secret&state=state-secret',
        note: 'token=inline-secret',
      },
    };
    cyclic.self = cyclic;

    const sanitized = sanitizeDiagnosticValue(cyclic);
    const serialized = JSON.stringify(sanitized);
    expect(serialized).toContain('[REDACTED]');
    expect(serialized).toContain('[CIRCULAR]');
    expect(serialized).not.toMatch(/pw-secret|auth-secret|query-secret|state-secret|inline-secret/);
  });

  it('完整脱敏 Authorization 与 Proxy-Authorization header 值', () => {
    const sanitized = sanitizeDiagnosticString(
      [
        'Authorization: Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==',
        'Proxy-Authorization=Bearer proxy-access-token',
        'authorization: Digest username="Mufasa", realm="testrealm", nonce="nonce-secret", uri="/dir/index.html", response="digest-response", opaque="opaque-secret"',
      ].join('\n')
    );

    expect(sanitized).toBe(
      [
        'Authorization: [REDACTED]',
        'Proxy-Authorization=[REDACTED]',
        'authorization: [REDACTED]',
      ].join('\n')
    );
    expect(sanitized).not.toMatch(
      /QWxhZGRpbjpvcGVuIHNlc2FtZQ|proxy-access-token|Mufasa|testrealm|nonce-secret|digest-response|opaque-secret/
    );
  });

  it('键名中的 Basic、Digest、Bearer 凭据也脱敏，并安全处理 Symbol、getter 与键碰撞', () => {
    const value: Record<PropertyKey, unknown> = {};
    let getterCalled = false;
    Object.defineProperty(value, 'Authorization: Basic YmFzaWMta2V5LXNlY3JldA==', {
      enumerable: true,
      value: 'basic-value-secret',
    });
    Object.defineProperty(value, 'Authorization: Bearer bearer-key-secret', {
      enumerable: true,
      get() {
        getterCalled = true;
        throw new Error('getter-key-secret');
      },
    });
    Object.defineProperty(
      value,
      Symbol('Proxy-Authorization: Digest username="server-user", nonce="digest-key-secret"'),
      {
        enumerable: true,
        value: 'digest-value-secret',
      }
    );

    const sanitized = sanitizeDiagnosticValue(value);
    const keys = Object.keys(sanitized as Record<string, unknown>);
    const serialized = JSON.stringify(sanitized);

    expect(getterCalled).toBe(false);
    expect(keys).toHaveLength(3);
    expect(keys).toContain('Authorization: [REDACTED]');
    expect(keys).toContain('Authorization: [REDACTED] [DUPLICATE_2]');
    expect(keys.some((key) => key.startsWith('Symbol(Proxy-Authorization: [REDACTED]'))).toBe(true);
    expect(serialized).not.toMatch(
      /YmFzaWMta2V5LXNlY3JldA|bearer-key-secret|server-user|digest-key-secret|basic-value-secret|digest-value-secret|getter-key-secret/
    );
  });

  it('对超长字符串进行有界截断', () => {
    expect(sanitizeDiagnosticString('x'.repeat(3_000))).toHaveLength(2_012);
    expect(sanitizeDiagnosticString('x'.repeat(3_000))).toMatch(/\[TRUNCATED\]$/);
  });

  it('恶意 getter、Proxy 与循环对象不会使异常序列化再次抛错', () => {
    const throwingGetter = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(throwingGetter, 'safe', { enumerable: true, value: 'ok' });
    Object.defineProperty(throwingGetter, 'boom', {
      enumerable: true,
      get() {
        throw new Error('getter-secret');
      },
    });
    throwingGetter.self = throwingGetter;
    const { proxy, revoke } = Proxy.revocable({ hidden: 'proxy-secret' }, {});
    revoke();

    expect(() => sanitizeDiagnosticValue({ throwingGetter, proxy })).not.toThrow();
    const serialized = JSON.stringify(sanitizeDiagnosticValue({ throwingGetter, proxy }));
    expect(serialized).toContain('[CIRCULAR]');
    expect(serialized).not.toContain('getter-secret');
  });

  it('全局节点和字节预算限制高分支 structured cause', () => {
    const buildTree = (depth: number): unknown => {
      if (depth === 0) return 'x'.repeat(2_000);
      const node: Record<string, unknown> = {};
      for (let index = 0; index < 30; index += 1) {
        Object.defineProperty(node, `branch-${index}`, {
          enumerable: true,
          get: () => buildTree(depth - 1),
        });
      }
      return node;
    };
    const error = new Error('root', { cause: buildTree(4) });

    const serialized = JSON.stringify(sanitizeDiagnosticValue(error));

    expect(serialized.length).toBeLessThan(35_000);
    expect(serialized).toMatch(/BUDGET_EXCEEDED|MAX_DEPTH|BYTE_BUDGET/);
  });
});
