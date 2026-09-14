import { vi } from 'vitest';

import { CustomersController } from '../customers.controller';

describe('CustomersController', () => {
  it('使用当前用户的数据范围更新 Leads 推进状态', async () => {
    const result = { id: 'customer-1', leadProgressStatus: 'ACTIVE' };
    const customersService = {
      updateLeadProgress: vi.fn().mockResolvedValue(result),
    };
    const dataScopeService = {
      resolveChargerScope: vi.fn().mockResolvedValue(['employee-1']),
    };
    const controller = new CustomersController(
      customersService as never,
      dataScopeService as never
    );
    const dto = { status: 'ACTIVE', version: 3 };
    const user = {
      id: 'employee-1',
      employeeId: 'employee-1',
      roles: ['SALES'],
    };

    await expect(
      controller.updateLeadProgress('customer-1', dto as never, user as never)
    ).resolves.toBe(result);
    expect(dataScopeService.resolveChargerScope).toHaveBeenCalledWith(
      'employee-1',
      ['SALES'],
      'crm',
      'customers',
      { employeeId: 'employee-1' }
    );
    expect(customersService.updateLeadProgress).toHaveBeenCalledWith(
      'customer-1',
      dto,
      user,
      ['employee-1'],
      'employee-1'
    );
  });

  it('restore、permanent、claim、单删与批删把调用方版本完整透传到 service', async () => {
    const customersService = {
      restore: vi.fn().mockResolvedValue({ id: 'customer-1', version: 6 }),
      permanentRemove: vi.fn().mockResolvedValue(undefined),
      claim: vi.fn().mockResolvedValue({ id: 'customer-1', version: 4 }),
      remove: vi.fn().mockResolvedValue(undefined),
      batchRemove: vi.fn().mockResolvedValue({ success: 1, skipped: [] }),
    };
    const dataScopeService = {
      resolveChargerScope: vi.fn().mockResolvedValue(['employee-1']),
    };
    const controller = new CustomersController(
      customersService as never,
      dataScopeService as never
    );
    const user = {
      id: 'employee-1',
      employeeId: 'employee-1',
      roles: ['ADMIN'],
    };

    await controller.restore('customer-1', { version: 5 } as never, user as never);
    await controller.permanentRemove('customer-1', { version: 6 } as never, user as never);
    await controller.claim('customer-1', { version: 3 } as never, user as never);
    await controller.remove('customer-1', user as never, { version: 4 } as never);
    const batchDto = {
      ids: ['11111111-1111-4111-8111-111111111111'],
      versions: { '11111111-1111-4111-8111-111111111111': 5 },
    };
    await controller.batchRemove(batchDto as never, user as never);

    expect(customersService.restore).toHaveBeenCalledWith(
      'customer-1',
      { version: 5 },
      user,
      ['employee-1'],
      'employee-1'
    );
    expect(customersService.permanentRemove).toHaveBeenCalledWith('customer-1', { version: 6 });
    expect(customersService.claim).toHaveBeenCalledWith('customer-1', { version: 3 }, user);
    expect(customersService.remove).toHaveBeenCalledWith(
      'customer-1',
      user,
      ['employee-1'],
      'employee-1',
      4
    );
    expect(customersService.batchRemove).toHaveBeenCalledWith(
      batchDto,
      user,
      ['employee-1'],
      'employee-1'
    );
  });

  it('修正历史线索阶段转发到 service，不再按角色码拦截', async () => {
    const result = { id: 'customer-1', leadStage: 'SQL' };
    const customersService = {
      correctLeadStage: vi.fn().mockResolvedValue(result),
    };
    const controller = new CustomersController(customersService as never, {} as never);
    const dto = {
      leadStage: 'SQL',
      leadStageQualifiedAt: '2026-07-20T07:55:50.524Z',
      reason: '修复进展状态误降级',
      version: 4,
    };
    const actor = { id: 'employee-1', employeeId: 'employee-1', roles: ['SALES'] };

    await expect(
      controller.correctLeadStage('customer-1', dto as never, actor as never)
    ).resolves.toBe(result);
    expect(customersService.correctLeadStage).toHaveBeenCalledWith('customer-1', dto, actor);
  });
});
