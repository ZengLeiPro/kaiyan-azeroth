import { vi } from 'vitest';

import type { CurrentUserType } from '../../auth/decorators/current-user.decorator';
import { EffortRecordsController } from '../effort-records.controller';

describe('EffortRecordsController', () => {
  const user: CurrentUserType = {
    id: 'user-1',
    username: 'alice',
    roles: ['PM'],
    employeeId: 'emp-1',
  };

  it('工时记录列表使用 effort_records 配置的数据范围', async () => {
    const effortRecordsService = {
      findAll: vi.fn().mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
      }),
    };
    const dataScope = {
      resolveChargerScope: vi.fn().mockResolvedValue(null),
    };
    const controller = new EffortRecordsController(
      effortRecordsService as never,
      {} as never,
      dataScope as never
    );
    const query = { page: 1, pageSize: 20, sortOrder: 'desc' as const };
    const rawQuery = { page: '1', pageSize: '20' };

    await controller.findAll(query as never, { query: rawQuery } as never, user);

    expect(dataScope.resolveChargerScope).toHaveBeenCalledWith(
      'user-1',
      ['PM'],
      'projects',
      'effort_records',
      { employeeId: 'emp-1' }
    );
    expect(effortRecordsService.findAll).toHaveBeenCalledWith(query, rawQuery, null);
  });
});
