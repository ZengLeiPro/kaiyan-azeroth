import { describe, expect, it } from 'vitest';

import { ALLOW_ANY_AUTHENTICATED_KEY } from '../../auth/decorators/allow-any-authenticated.decorator';
import { PERMISSION_KEY } from '../../auth/decorators/require-permission.decorator';
import { DashboardController } from '../dashboard.controller';

describe('DashboardController authorization', () => {
  it('首页统计允许任意登录用户访问，由服务层数据范围限制可见数据', () => {
    const handler = DashboardController.prototype.getStats;

    expect(Reflect.getMetadata(ALLOW_ANY_AUTHENTICATED_KEY, handler)).toBe(true);
    expect(Reflect.getMetadata(PERMISSION_KEY, handler)).toBeUndefined();
  });
});
