import { describe, expect, it, vi } from 'vitest';

import type { FilterSchemeRegistry } from '../../../common/filter-scheme';
import {
  LOGIN_LOG_FILTER_REGISTRY,
  OPERATION_LOG_FILTER_REGISTRY,
} from '../operation-logs.filter-registry';
import { OperationLogsModule } from '../operation-logs.module';

describe('operation log filter registries', () => {
  it('保留操作日志现有筛选字段、顺序和查询字段映射', () => {
    expect(OPERATION_LOG_FILTER_REGISTRY.pageKey).toBe('system.operation_logs');
    expect(OPERATION_LOG_FILTER_REGISTRY.defaults.fields).toEqual([
      { fieldKey: 'module', control: 'multiSelect' },
      { fieldKey: 'action', control: 'multiSelect' },
      { fieldKey: 'operator', control: 'text' },
      { fieldKey: 'createdAt', control: 'dateRange' },
    ]);
    expect(OPERATION_LOG_FILTER_REGISTRY.fields.action.build(['create'])).toEqual({
      action: { in: ['create'] },
    });
    expect(OPERATION_LOG_FILTER_REGISTRY.fields.operator.build('张三')).toEqual({
      employee: {
        OR: [
          { username: { contains: '张三', mode: 'insensitive' } },
          { name: { contains: '张三', mode: 'insensitive' } },
        ],
      },
    });
  });

  it('保留登录日志现有筛选字段、枚举和值', () => {
    expect(LOGIN_LOG_FILTER_REGISTRY.pageKey).toBe('system.login_logs');
    expect(LOGIN_LOG_FILTER_REGISTRY.defaults.fields.map((item) => item.fieldKey)).toEqual([
      'username',
      'actionType',
      'status',
      'createdAt',
    ]);
    expect(LOGIN_LOG_FILTER_REGISTRY.fields.status.optionsSource?.()).toEqual([
      { value: 'success', label: '成功' },
      { value: 'fail', label: '失败' },
    ]);
    expect(LOGIN_LOG_FILTER_REGISTRY.fields.status.build(['fail'])).toEqual({
      status: { in: ['fail'] },
    });
  });

  it('模块初始化时注册操作日志和登录日志 registry', () => {
    const register = vi.fn();
    const module = new OperationLogsModule({ register } as unknown as FilterSchemeRegistry);

    module.onModuleInit();

    expect(register).toHaveBeenNthCalledWith(1, OPERATION_LOG_FILTER_REGISTRY);
    expect(register).toHaveBeenNthCalledWith(2, LOGIN_LOG_FILTER_REGISTRY);
  });
});
