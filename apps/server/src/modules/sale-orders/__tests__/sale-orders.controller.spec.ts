import { vi } from 'vitest';

import { SaleOrdersController } from '../sale-orders.controller';

describe('SaleOrdersController', () => {
  it('创建合同订单时把当前数据范围传入业务层', async () => {
    const result = { id: 'order-1' };
    const saleOrdersService = {
      create: vi.fn().mockResolvedValue(result),
    };
    const dataScopeService = {
      resolveChargerScope: vi.fn().mockResolvedValue(['employee-1']),
    };
    const controller = new SaleOrdersController(
      saleOrdersService as never,
      dataScopeService as never,
      {} as never
    );
    const dto = { customerId: 'customer-1', products: [] };
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
      'sale_orders',
      { employeeId: 'employee-1' }
    );
    expect(saleOrdersService.create).toHaveBeenCalledWith(dto, user, ['employee-1'], 'employee-1');
  });

  it('使用当前用户的数据范围提交作废申请', async () => {
    const result = { id: 'approval-1' };
    const saleOrdersService = {
      submitVoidRequest: vi.fn().mockResolvedValue(result),
    };
    const dataScopeService = {
      resolveChargerScope: vi.fn().mockResolvedValue(['employee-1']),
    };
    const controller = new SaleOrdersController(
      saleOrdersService as never,
      dataScopeService as never,
      {} as never
    );
    const dto = { reason: '合同重复录入', version: 5 };
    const user = {
      id: 'user-1',
      employeeId: 'employee-1',
      roles: ['SALES'],
    };

    await expect(controller.submitVoidRequest('order-1', dto, user as never)).resolves.toBe(result);
    expect(dataScopeService.resolveChargerScope).toHaveBeenCalledWith(
      'user-1',
      ['SALES'],
      'crm',
      'sale_orders',
      { employeeId: 'employee-1' }
    );
    expect(saleOrdersService.submitVoidRequest).toHaveBeenCalledWith(
      'order-1',
      dto,
      user,
      ['employee-1'],
      'user-1'
    );
  });

  it('删除合同订单时把有效版本号传入业务层', async () => {
    const saleOrdersService = {
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const dataScopeService = {
      resolveChargerScope: vi.fn().mockResolvedValue(['employee-1']),
    };
    const controller = new SaleOrdersController(
      saleOrdersService as never,
      dataScopeService as never,
      {} as never
    );
    const user = {
      id: 'user-1',
      employeeId: 'employee-1',
      roles: ['SALES'],
    };

    await expect(controller.remove('order-1', user as never, '5')).resolves.toEqual({
      success: true,
    });
    expect(saleOrdersService.remove).toHaveBeenCalledWith(
      'order-1',
      user,
      ['employee-1'],
      'user-1',
      5
    );
  });

  it('删除合同订单缺少版本号时拒绝请求', async () => {
    const saleOrdersService = {
      remove: vi.fn(),
    };
    const dataScopeService = {
      resolveChargerScope: vi.fn().mockResolvedValue(['employee-1']),
    };
    const controller = new SaleOrdersController(
      saleOrdersService as never,
      dataScopeService as never,
      {} as never
    );
    const user = {
      id: 'user-1',
      employeeId: 'employee-1',
      roles: ['SALES'],
    };

    await expect(controller.remove('order-1', user as never)).rejects.toThrow(
      '删除合同订单必须携带有效的 version'
    );
    expect(saleOrdersService.remove).not.toHaveBeenCalled();
  });
});
