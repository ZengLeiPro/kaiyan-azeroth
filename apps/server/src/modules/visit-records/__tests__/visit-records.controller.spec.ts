import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { DataScopeService } from '../../../common/services/data-scope.service';
import type { BusinessApprovalService } from '../../approvals/business-approval.service';
import type { CurrentUserType } from '../../auth/decorators/current-user.decorator';
import { VisitRecordsController } from '../visit-records.controller';
import type { VisitRecordsService } from '../visit-records.service';

const user = {
  id: 'user-1',
  employeeId: 'emp-1',
  roles: ['SALES'],
} as CurrentUserType;

describe('VisitRecordsController remove version contract', () => {
  function createController(remove = vi.fn(), resolveChargerScope = vi.fn()) {
    return {
      controller: new VisitRecordsController(
        { remove } as unknown as VisitRecordsService,
        { resolveChargerScope } as unknown as DataScopeService,
        {} as BusinessApprovalService
      ),
      remove,
      resolveChargerScope,
    };
  }

  it('缺少或非法 version 时返回 400，且不进入数据范围与删除逻辑', async () => {
    const { controller, remove, resolveChargerScope } = createController();

    await expect(controller.remove('vr-1', user, undefined)).rejects.toBeInstanceOf(
      BadRequestException
    );
    await expect(controller.remove('vr-1', user, '1.5')).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(resolveChargerScope).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('将正整数 query version 透传给 service CAS', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const resolveChargerScope = vi.fn().mockResolvedValue(['emp-1']);
    const { controller } = createController(remove, resolveChargerScope);

    await expect(controller.remove('vr-1', user, '3')).resolves.toEqual({ success: true });
    expect(remove).toHaveBeenCalledWith('vr-1', user, ['emp-1'], 'user-1', 3);
  });
});
