import axios from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createLogger,
  getErrorTraceId,
  LoggerReporter,
  SafeLogEvent,
  sanitizeLogString,
  sanitizeLogValue,
} from './logger';

function createAxiosError(data: unknown, headers: Record<string, string> = {}) {
  return new axios.AxiosError(
    'request failed token=client-secret',
    'ERR_BAD_RESPONSE',
    undefined,
    {},
    {
      status: 500,
      statusText: 'Internal Server Error',
      headers,
      config: { headers: {} } as never,
      data,
    }
  );
}

describe('safe logger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('向可注入 reporter 提供脱敏结构化事件，并关联服务端 traceId', () => {
    const events: SafeLogEvent[] = [];
    const reporter: LoggerReporter = { report: (event) => events.push(event) };
    const testLogger = createLogger({ isProduction: true, reporter });
    const error = createAxiosError({
      message: '服务器内部错误',
      traceId: 'server-trace-123',
      password: 'response-secret',
    });
    error.stack =
      'AxiosError: authorization=Bearer stack-secret\n at https://example.test/x?token=url-secret';

    testLogger.error('Payments', '保存失败 secret=inline-secret', error, {
      authorization: 'Bearer details-secret',
      nested: { password: 'nested-secret' },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      expect.objectContaining({
        level: 'error',
        context: 'Payments',
        traceId: 'server-trace-123',
        error: expect.objectContaining({ name: 'AxiosError' }),
      })
    );
    const serialized = JSON.stringify(events[0]);
    expect(serialized).toContain('[REDACTED]');
    expect(serialized).not.toMatch(
      /client-secret|response-secret|stack-secret|url-secret|inline-secret|details-secret|nested-secret/
    );
  });

  it('生产默认 adapter 只将脱敏 error 与 traceId 输出到 console.error', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const productionLogger = createLogger({ isProduction: true });
    const error = createAxiosError({ message: '服务器内部错误', traceId: 'trace-prod-1' });

    productionLogger.warn('Context', 'warn should stay local');
    productionLogger.info('Context', 'info should stay local');
    productionLogger.error('SensitiveContext', 'password=message-secret', error);

    expect(warnSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy.mock.calls[0]?.[0]).toEqual({
      error: expect.objectContaining({ name: 'AxiosError' }),
      traceId: 'trace-prod-1',
    });
    const serialized = JSON.stringify(errorSpy.mock.calls[0]?.[0]);
    expect(serialized).not.toMatch(/SensitiveContext|message-secret|client-secret/);
  });

  it('优先从响应体提取合法 traceId，并回退响应头且拒绝注入字符', () => {
    expect(
      getErrorTraceId(
        createAxiosError({ traceId: 'body-trace' }, { 'x-request-id': 'header-trace' })
      )
    ).toBe('body-trace');
    expect(getErrorTraceId(createAxiosError({}, { 'x-request-id': 'header-trace' }))).toBe(
      'header-trace'
    );
    expect(getErrorTraceId(createAxiosError({ traceId: 'bad\r\ntrace' }))).toBeUndefined();
  });

  it('完整脱敏 Authorization 与 Proxy-Authorization header 值', () => {
    const sanitized = sanitizeLogString(
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
    Object.defineProperty(value, 'Authorization: Basic d2ViLWtleS1zZWNyZXQ=', {
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
      Symbol('Proxy-Authorization: Digest username="web-user", nonce="digest-key-secret"'),
      {
        enumerable: true,
        value: 'digest-value-secret',
      }
    );

    const sanitized = sanitizeLogValue(value);
    const keys = Object.keys(sanitized as Record<string, unknown>);
    const serialized = JSON.stringify(sanitized);

    expect(getterCalled).toBe(false);
    expect(keys).toHaveLength(3);
    expect(keys).toContain('Authorization: [REDACTED]');
    expect(keys).toContain('Authorization: [REDACTED] [DUPLICATE_2]');
    expect(keys.some((key) => key.startsWith('Symbol(Proxy-Authorization: [REDACTED]'))).toBe(true);
    expect(serialized).not.toMatch(
      /d2ViLWtleS1zZWNyZXQ|bearer-key-secret|web-user|digest-key-secret|basic-value-secret|digest-value-secret|getter-key-secret/
    );
  });

  it('递归处理敏感键、URL query、循环对象与长度限制', () => {
    const value: Record<string, unknown> = {
      password: 'pw',
      url: 'https://example.test?a=one&b=two',
      note: 'token=three',
      long: 'x'.repeat(3_000),
    };
    value.self = value;

    const serialized = JSON.stringify(sanitizeLogValue(value));
    expect(serialized).toContain('[REDACTED]');
    expect(serialized).toContain('[CIRCULAR]');
    expect(serialized).toContain('[TRUNCATED]');
    expect(serialized).not.toMatch(/one|two|three|"pw"/);
  });

  it('抛错 getter、revoked Proxy 和循环 details 不会让 logger 自身崩溃', () => {
    const events: SafeLogEvent[] = [];
    const testLogger = createLogger({
      isProduction: true,
      reporter: { report: (event) => events.push(event) },
    });
    const getter = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(getter, 'boom', {
      enumerable: true,
      get() {
        throw new Error('getter-secret');
      },
    });
    getter.self = getter;
    const { proxy, revoke } = Proxy.revocable({ private: 'proxy-secret' }, {});
    revoke();

    expect(() => testLogger.error('GetterCase', getter, proxy)).not.toThrow();
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0])).not.toContain('getter-secret');
  });

  it('buildEvent 失败也走固定兜底事件且不抛错', () => {
    const events: SafeLogEvent[] = [];
    const testLogger = createLogger({
      isProduction: true,
      reporter: { report: (event) => events.push(event) },
    });
    const hostileContext = new Proxy(Object.create(null), {
      get() {
        throw new Error('context-getter-secret');
      },
    }) as never;

    expect(() => testLogger.error(hostileContext, 'ignored')).not.toThrow();
    expect(events).toEqual([
      expect.objectContaining({
        context: 'Logger',
        error: expect.objectContaining({ name: 'DiagnosticSerializationError' }),
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain('context-getter-secret');
  });

  it('全局节点和字节预算限制高分支对象', () => {
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

    const serialized = JSON.stringify(sanitizeLogValue(buildTree(4)));

    expect(serialized.length).toBeLessThan(35_000);
    expect(serialized).toMatch(/BUDGET_EXCEEDED|MAX_DEPTH|BYTE_BUDGET/);
  });
});
