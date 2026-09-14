import { BadRequestException } from '@nestjs/common';
import { vi } from 'vitest';

import { PaymentsController } from '../payments.controller';

describe('PaymentsController', () => {
  it('创建回款时把当前数据范围传入业务层', async () => {
    const result = { id: 'payment-1' };
    const paymentsService = {
      create: vi.fn().mockResolvedValue(result),
    };
    const dataScopeService = {
      resolveChargerScope: vi.fn().mockResolvedValue(['employee-1']),
    };
    const controller = new PaymentsController(
      paymentsService as never,
      dataScopeService as never,
      {} as never
    );
    const dto = {
      saleOrderId: 'order-1',
      paymentAmount: 100,
      items: [{ saleOrderProductId: 'product-1', amount: 100, paymentMode: 'direct' }],
    };
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
      'payments',
      { employeeId: 'employee-1' }
    );
    expect(paymentsService.create).toHaveBeenCalledWith(dto, user, ['employee-1'], 'employee-1');
  });

  it.each([undefined, '', '0', '-1', '1.5', 'abc'])(
    '删除回款拒绝缺失或非法 version：%s',
    async (version) => {
      const paymentsService = { remove: vi.fn() };
      const dataScopeService = {
        resolveChargerScope: vi.fn().mockResolvedValue(['employee-1']),
      };
      const controller = new PaymentsController(
        paymentsService as never,
        dataScopeService as never,
        {} as never
      );
      const user = {
        id: 'user-1',
        employeeId: 'employee-1',
        roles: ['SALES'],
      };

      await expect(controller.remove('payment-1', user as never, version)).rejects.toThrow(
        BadRequestException
      );
      expect(dataScopeService.resolveChargerScope).not.toHaveBeenCalled();
      expect(paymentsService.remove).not.toHaveBeenCalled();
    }
  );

  it('删除回款把正确 version 原样传入业务层', async () => {
    const paymentsService = { remove: vi.fn().mockResolvedValue(undefined) };
    const dataScopeService = {
      resolveChargerScope: vi.fn().mockResolvedValue(['employee-1']),
    };
    const controller = new PaymentsController(
      paymentsService as never,
      dataScopeService as never,
      {} as never
    );
    const user = {
      id: 'user-1',
      employeeId: 'employee-1',
      roles: ['SALES'],
    };

    await expect(controller.remove('payment-1', user as never, '3')).resolves.toEqual({
      success: true,
    });
    expect(paymentsService.remove).toHaveBeenCalledWith(
      'payment-1',
      user,
      ['employee-1'],
      'employee-1',
      3
    );
  });

  it('批量删除把 ids 与逐行 versions 原样传入业务层', async () => {
    const paymentsService = {
      batchRemove: vi.fn().mockResolvedValue({ success: 1, skipped: [], errors: [] }),
    };
    const dataScopeService = {
      resolveChargerScope: vi.fn().mockResolvedValue(['employee-1']),
    };
    const controller = new PaymentsController(
      paymentsService as never,
      dataScopeService as never,
      {} as never
    );
    const dto = { ids: ['payment-1'], versions: { 'payment-1': 6 } };
    const user = {
      id: 'user-1',
      employeeId: 'employee-1',
      roles: ['SALES'],
    };

    await controller.batchRemove(dto as never, user as never);

    expect(paymentsService.batchRemove).toHaveBeenCalledWith(
      dto,
      user,
      ['employee-1'],
      'employee-1'
    );
  });

  it('使用当前用户的数据范围提交作废申请', async () => {
    const result = { id: 'approval-1' };
    const paymentsService = {
      submitVoidRequest: vi.fn().mockResolvedValue(result),
    };
    const dataScopeService = {
      resolveChargerScope: vi.fn().mockResolvedValue(['employee-1']),
    };
    const controller = new PaymentsController(
      paymentsService as never,
      dataScopeService as never,
      {} as never
    );
    const dto = { reason: '录入错误', version: 3 };
    const user = {
      id: 'user-1',
      employeeId: 'employee-1',
      roles: ['SALES'],
    };

    await expect(controller.submitVoidRequest('payment-1', dto, user as never)).resolves.toBe(
      result
    );
    expect(dataScopeService.resolveChargerScope).toHaveBeenCalledWith(
      'user-1',
      ['SALES'],
      'crm',
      'payments',
      { employeeId: 'employee-1' }
    );
    expect(paymentsService.submitVoidRequest).toHaveBeenCalledWith(
      'payment-1',
      dto,
      user,
      ['employee-1'],
      'employee-1'
    );
  });
});
