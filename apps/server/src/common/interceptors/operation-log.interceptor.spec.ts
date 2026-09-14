import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import type { OperationLogsService } from '../../modules/operation-logs/operation-logs.service';
import { OperationLogInterceptor } from './operation-log.interceptor';

function httpContext(method: 'PUT' | 'DELETE', body: Record<string, unknown>): ExecutionContext {
  const request = {
    method,
    route: { path: '/api/v1/employees/:id/dingtalk-binding' },
    path: '/api/v1/employees/employee-target/dingtalk-binding',
    params: { id: 'employee-target' },
    body,
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    user: {
      id: 'employee-admin',
      employeeId: 'employee-admin',
      username: 'admin',
      roles: ['ADMIN'],
    },
  };

  return {
    getType: () => 'http',
    getHandler: () => vi.fn(),
    getClass: () => class TestController {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('OperationLogInterceptor DingTalk binding actions', () => {
  it.each([
    ['PUT', 'bind'],
    ['DELETE', 'unbind'],
  ] as const)('maps %s dingtalk-binding to %s with actor and target', async (method, action) => {
    const log = vi.fn().mockResolvedValue(undefined);
    const interceptor = new OperationLogInterceptor(new Reflector(), {
      log,
    } as unknown as OperationLogsService);
    const body =
      method === 'PUT'
        ? {
            version: 2,
            dingtalkUserId: 'ding-user-new',
            dingtalkUnionId: null,
            token: 'must-not-be-logged',
          }
        : { version: 2, password: 'must-not-be-logged' };
    const next: CallHandler = { handle: () => of({ id: 'employee-target', version: 3 }) };

    await lastValueFrom(interceptor.intercept(httpContext(method, body), next));

    await vi.waitFor(() => expect(log).toHaveBeenCalledOnce());
    expect(log).toHaveBeenCalledWith({
      employeeId: 'employee-admin',
      ipAddress: '127.0.0.1',
      module: 'employees',
      action,
      target: 'employee-target',
      details: {
        kind: 'request',
        body: {
          ...body,
          ...(method === 'PUT' ? { token: '[REDACTED]' } : { password: '[REDACTED]' }),
        },
        params: { id: 'employee-target' },
      },
    });
  });
});
