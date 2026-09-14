import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { DataScopeService } from '../../../common/services/data-scope.service';
import type { CurrentUserType } from '../../auth/decorators/current-user.decorator';
import { KeepRecordsController } from '../keep-records.controller';
import type { KeepRecordsService } from '../keep-records.service';

const user = {
  id: 'user-1',
  employeeId: 'emp-1',
  roles: ['SALES'],
} as CurrentUserType;

describe('KeepRecordsController remove version contract', () => {
  it('缺少或非法 version 时返回 400，且不进入数据范围与删除逻辑', async () => {
    const remove = vi.fn();
    const resolveChargerScope = vi.fn();
    const controller = new KeepRecordsController(
      { remove } as unknown as KeepRecordsService,
      { resolveChargerScope } as unknown as DataScopeService
    );

    await expect(controller.remove('kr-1', user, undefined)).rejects.toBeInstanceOf(
      BadRequestException
    );
    await expect(controller.remove('kr-1', user, '0')).rejects.toBeInstanceOf(BadRequestException);
    expect(resolveChargerScope).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('将正整数 query version 透传给 service CAS', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const resolveChargerScope = vi.fn().mockResolvedValue(['emp-1']);
    const controller = new KeepRecordsController(
      { remove } as unknown as KeepRecordsService,
      { resolveChargerScope } as unknown as DataScopeService
    );

    await expect(controller.remove('kr-1', user, '3')).resolves.toEqual({ success: true });
    expect(remove).toHaveBeenCalledWith('kr-1', user, ['emp-1'], 'user-1', 3);
  });
});
