import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import {
  ensureRequestDiagnosticContext,
  requestDiagnosticContextMiddleware,
  RequestWithDiagnosticContext,
} from './request-context';

function createRequest(requestId?: string): RequestWithDiagnosticContext {
  return {
    headers: requestId === undefined ? {} : { 'x-request-id': requestId },
  } as Request;
}

describe('request diagnostic context', () => {
  it('不信任任意外部 x-request-id，并将生成的 UUID 返回客户端', () => {
    const request = createRequest('attacker-controlled-trace');
    const setHeader = vi.fn();
    const next = vi.fn() as NextFunction;

    requestDiagnosticContextMiddleware(request, { setHeader } as unknown as Response, next);

    expect(request.diagnosticContext?.traceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(request.diagnosticContext?.traceId).not.toBe('attacker-controlled-trace');
    expect(setHeader).toHaveBeenCalledWith('x-request-id', request.diagnosticContext?.traceId);
    expect(next).toHaveBeenCalledOnce();
  });

  it('保留进程内由受控代理适配器预先建立的 diagnosticContext', () => {
    const request = createRequest('external-spoof');
    request.diagnosticContext = { traceId: 'trusted-edge-trace', startedAt: 123 };

    expect(ensureRequestDiagnosticContext(request)).toEqual({
      traceId: 'trusted-edge-trace',
      startedAt: 123,
    });
  });

  it('恶意或超长请求头均不会进入 traceId', () => {
    const malicious = createRequest(`bad\r\nauthorization: Bearer secret`);
    const long = createRequest('x'.repeat(129));

    const maliciousContext = ensureRequestDiagnosticContext(malicious);
    const longContext = ensureRequestDiagnosticContext(long);

    expect(maliciousContext.traceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(longContext.traceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(maliciousContext.traceId).not.toContain('secret');
  });
});
