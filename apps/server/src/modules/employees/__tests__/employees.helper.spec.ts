import { describe, expect, it } from 'vitest';

import { ACTIVE_EMPLOYEE_WHERE } from '../employees.helper';

describe('ACTIVE_EMPLOYEE_WHERE (ORG-01)', () => {
  it('应包含 deletedAt:null / status:active / canLogin:true 三个条件', () => {
    expect(ACTIVE_EMPLOYEE_WHERE).toEqual({
      deletedAt: null,
      status: 'active',
      canLogin: true,
    });
  });

  it('canLogin=true 是必备字段（剔除 25 个非员工节点）', () => {
    // 关键不变量：少了 canLogin 会让 39 active 含 25 非员工节点
    expect(ACTIVE_EMPLOYEE_WHERE.canLogin).toBe(true);
  });

  it('展开后可与其他 where 条件合并（spread 不丢字段）', () => {
    const merged = { ...ACTIVE_EMPLOYEE_WHERE, id: 'emp-1' };
    expect(merged).toEqual({
      deletedAt: null,
      status: 'active',
      canLogin: true,
      id: 'emp-1',
    });
  });
});
