import { BadRequestException } from '@nestjs/common';
import { vi } from 'vitest';

import { OpportunitiesController } from '../opportunities.controller';

describe('OpportunitiesController', () => {
  it('创建商机时把当前数据范围传入业务层', async () => {
    const result = { id: 'opportunity-1' };
    const opportunitiesService = {
      create: vi.fn().mockResolvedValue(result),
    };
    const dataScopeService = {
      resolveChargerScope: vi.fn().mockResolvedValue(['employee-1']),
    };
    const controller = new OpportunitiesController(
      opportunitiesService as never,
      dataScopeService as never
    );
    const dto = { customerId: 'customer-1' };
    const user = {
      id: 'user-1',
      employeeId: 'employee-1',
      roles: ['SALES'],
    };

    await expect(controller.create(dto as never, user as never)).resolves.toBe(result);
    expect(dataScopeService.resolveChargerScope).toHaveBeenCalledWith(
      'user-1',
      ['SALES'],
      'crm',
      'opportunities',
      { employeeId: 'employee-1' }
    );
    expect(opportunitiesService.create).toHaveBeenCalledWith(
      dto,
      user,
      ['employee-1'],
      'employee-1'
    );
  });

  it.each([undefined, '', '0', '-1', '1.5', 'abc'])(
    '删除商机拒绝缺失或非法 version：%s',
    async (version) => {
      const opportunitiesService = { remove: vi.fn() };
      const dataScopeService = { resolveChargerScope: vi.fn() };
      const controller = new OpportunitiesController(
        opportunitiesService as never,
        dataScopeService as never
      );
      const user = {
        id: 'user-1',
        employeeId: 'employee-1',
        roles: ['SALES'],
      };

      await expect(controller.remove('opportunity-1', user as never, version)).rejects.toThrow(
        BadRequestException
      );
      expect(dataScopeService.resolveChargerScope).not.toHaveBeenCalled();
      expect(opportunitiesService.remove).not.toHaveBeenCalled();
    }
  );

  it('删除商机把正整数 query version 透传给 service CAS', async () => {
    const opportunitiesService = { remove: vi.fn().mockResolvedValue(undefined) };
    const dataScopeService = {
      resolveChargerScope: vi.fn().mockResolvedValue(['employee-1']),
    };
    const controller = new OpportunitiesController(
      opportunitiesService as never,
      dataScopeService as never
    );
    const user = {
      id: 'user-1',
      employeeId: 'employee-1',
      roles: ['SALES'],
    };

    await expect(controller.remove('opportunity-1', user as never, '3')).resolves.toEqual({
      success: true,
    });
    expect(opportunitiesService.remove).toHaveBeenCalledWith(
      'opportunity-1',
      user,
      ['employee-1'],
      'user-1',
      3
    );
  });
});
