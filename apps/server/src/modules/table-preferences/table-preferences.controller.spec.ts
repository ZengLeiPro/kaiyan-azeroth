import { describe, expect, it, vi } from 'vitest';

import type { CurrentUserType } from '../auth/decorators/current-user.decorator';
import { TablePreferencesController } from './table-preferences.controller';

describe('TablePreferencesController', () => {
  it('任意登录用户可按 pageKey 读取服务端表格偏好', async () => {
    const preference = { id: 'preference-1', pageKey: 'customers', version: 2 };
    const service = { findByPageKey: vi.fn().mockResolvedValue(preference) };
    const controller = new TablePreferencesController(service as never);

    await expect(controller.findByPageKey({ pageKey: 'customers' })).resolves.toBe(preference);
    expect(service.findByPageKey).toHaveBeenCalledWith('customers');
  });

  it('写入偏好时把当前管理员 作为审计操作者传给业务层', async () => {
    const saved = { id: 'preference-1', pageKey: 'customers', version: 3 };
    const service = { upsert: vi.fn().mockResolvedValue(saved) };
    const controller = new TablePreferencesController(service as never);
    const body = { pageKey: 'customers', configuration: { columns: ['customerName'] } };
    const user: CurrentUserType = {
      id: 'employee-admin',
      employeeId: 'employee-admin',
      username: 'admin',
      roles: ['SUPER_ADMIN'],
    };

    await expect(controller.upsert(body as never, user)).resolves.toBe(saved);
    expect(service.upsert).toHaveBeenCalledWith(body, user);
  });
});
