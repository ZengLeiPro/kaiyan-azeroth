import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DingtalkAuth } from '../../dingtalk-core/dingtalk-auth.service';
import { DingtalkHttp } from '../../dingtalk-core/dingtalk-http';
import { DingtalkTodoService } from '../dingtalk-todo.service';

function makeConfig(overrides: Record<string, string> = {}): ConfigService {
  return {
    get: vi.fn((key: string) => overrides[key] ?? undefined),
  } as unknown as ConfigService;
}

function makeAuth(token = 'token-AAA'): DingtalkAuth & {
  invalidate: ReturnType<typeof vi.fn>;
  getAccessToken: ReturnType<typeof vi.fn>;
} {
  return {
    getAccessToken: vi.fn().mockResolvedValue(token),
    invalidate: vi.fn(),
  } as unknown as DingtalkAuth & {
    invalidate: ReturnType<typeof vi.fn>;
    getAccessToken: ReturnType<typeof vi.fn>;
  };
}

describe('DingtalkTodoService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('createTask 使用 unionId 创建工作待办并传 detailUrl', async () => {
    const auth = makeAuth();
    const svc = new DingtalkTodoService(makeConfig(), auth);
    const httpSpy = vi.spyOn(DingtalkHttp.prototype, 'post').mockResolvedValue({ id: 'todo-1' });

    const result = await svc.createTask({
      creatorUnionId: 'union-creator',
      sourceId: 'azeroth:approval-task:task-1',
      subject: '待审批：测试审批',
      description: '请处理',
      executorUnionIds: ['union-executor'],
      detailUrl: {
        pcUrl: 'http://localhost:5173/approval/list?tab=pending&instanceId=inst-1',
        appUrl: 'http://localhost:5173/approval/list?tab=pending&instanceId=inst-1',
      },
    });

    expect(result?.id).toBe('todo-1');
    expect(httpSpy).toHaveBeenCalledTimes(1);
    const [url, body, opts] = httpSpy.mock.calls[0]!;
    expect(url).toBe('/v1.0/todo/users/union-creator/tasks');
    expect((body as { sourceId: string }).sourceId).toBe('azeroth:approval-task:task-1');
    expect((body as { executorIds: string[] }).executorIds).toEqual(['union-executor']);
    expect((body as { detailUrl: { pcUrl: string } }).detailUrl.pcUrl).toContain(
      'instanceId=inst-1'
    );
    expect(
      (opts as { headers: Record<string, string> }).headers['x-acs-dingtalk-access-token']
    ).toBe('token-AAA');
  });

  it('completeTask 调 PUT 并设置 done=true', async () => {
    const auth = makeAuth();
    const svc = new DingtalkTodoService(makeConfig(), auth);
    const httpSpy = vi.spyOn(DingtalkHttp.prototype, 'put').mockResolvedValue({ result: true });

    const ok = await svc.completeTask({
      creatorUnionId: 'union-creator',
      taskId: 'todo-1',
      subject: '待审批：测试审批',
      description: '已处理',
      executorUnionIds: ['union-executor'],
    });

    expect(ok).toBe(true);
    expect(httpSpy).toHaveBeenCalledTimes(1);
    const [url, body] = httpSpy.mock.calls[0]!;
    expect(url).toBe('/v1.0/todo/users/union-creator/tasks/todo-1');
    expect((body as { done: boolean }).done).toBe(true);
    expect((body as { executorIds: string[] }).executorIds).toEqual(['union-executor']);
  });

  it('http 异常时不抛出，返回 null/false', async () => {
    const auth = makeAuth();
    const svc = new DingtalkTodoService(makeConfig(), auth);
    vi.spyOn(DingtalkHttp.prototype, 'post').mockRejectedValue(new Error('network down'));
    vi.spyOn(DingtalkHttp.prototype, 'put').mockRejectedValue(new Error('network down'));

    await expect(
      svc.createTask({
        creatorUnionId: 'union-creator',
        sourceId: 'source-1',
        subject: '标题',
        description: '描述',
        executorUnionIds: ['union-executor'],
        detailUrl: { pcUrl: 'https://example.com', appUrl: 'https://example.com' },
      })
    ).resolves.toBeNull();

    await expect(
      svc.completeTask({
        creatorUnionId: 'union-creator',
        taskId: 'todo-1',
        subject: '标题',
        description: '描述',
        executorUnionIds: ['union-executor'],
      })
    ).resolves.toBe(false);
  });
});
