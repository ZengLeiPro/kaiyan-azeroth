import { describe, expect, it, vi } from 'vitest';

import type { FilterSchemeRegistry } from '../../../common/filter-scheme';
import { USER_FILTER_REGISTRY } from '../users.filter-registry';
import { UsersModule } from '../users.module';

describe('USER_FILTER_REGISTRY', () => {
  it('保留用户页关键词、状态和角色默认筛选', () => {
    expect(USER_FILTER_REGISTRY.pageKey).toBe('system.users');
    expect(USER_FILTER_REGISTRY.defaults).toEqual({
      fields: [
        { fieldKey: 'status', control: 'multiSelect' },
        { fieldKey: 'roleId', control: 'entityMultiSelect' },
      ],
      keyword: {
        enabled: true,
        fieldKeys: ['username', 'phone', 'email'],
        placeholder: '用户名/手机号/邮箱',
      },
    });
    expect(USER_FILTER_REGISTRY.fields.status.build(['active'])).toEqual({
      loginStatus: { in: ['active'] },
    });
    expect(USER_FILTER_REGISTRY.fields.roleId.build(['role-a', 'role-b'])).toEqual({
      userRoles: { some: { roleId: { in: ['role-a', 'role-b'] } } },
    });
  });

  it('非法状态和空角色不生成筛选条件', () => {
    expect(USER_FILTER_REGISTRY.fields.status.build(['unknown'])).toBeNull();
    expect(USER_FILTER_REGISTRY.fields.roleId.build([])).toBeNull();
  });

  it('模块初始化时注册用户 registry', () => {
    const register = vi.fn();
    const module = new UsersModule({ register } as unknown as FilterSchemeRegistry);

    module.onModuleInit();

    expect(register).toHaveBeenCalledWith(USER_FILTER_REGISTRY);
  });
});
