import { BadRequestException } from '@nestjs/common';
import { vi } from 'vitest';

import { InvoicesController } from '../invoices.controller';

describe('InvoicesController', () => {
  it('创建发票时把当前数据范围传入业务层', async () => {
    const result = { id: 'invoice-1' };
    const invoicesService = {
      create: vi.fn().mockResolvedValue(result),
    };
    const dataScopeService = {
      resolveChargerScope: vi.fn().mockResolvedValue(['employee-1']),
    };
    const controller = new InvoicesController(
      invoicesService as never,
      dataScopeService as never,
      {} as never
    );
    const dto = { saleOrderId: 'order-1', invoiceAmount: 100 };
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
      'invoices',
      { employeeId: 'employee-1' }
    );
    expect(invoicesService.create).toHaveBeenCalledWith(dto, user, ['employee-1'], 'employee-1');
  });

  it.each([undefined, '', '0', '-1', '1.5', 'abc'])(
    '删除发票拒绝缺失或非法 version：%s',
    async (version) => {
      const invoicesService = { remove: vi.fn() };
      const dataScopeService = {
        resolveChargerScope: vi.fn().mockResolvedValue(['employee-1']),
      };
      const controller = new InvoicesController(
        invoicesService as never,
        dataScopeService as never,
        {} as never
      );
      const user = {
        id: 'user-1',
        employeeId: 'employee-1',
        roles: ['SALES'],
      };

      await expect(controller.remove('invoice-1', user as never, version)).rejects.toThrow(
        BadRequestException
      );
      expect(dataScopeService.resolveChargerScope).not.toHaveBeenCalled();
      expect(invoicesService.remove).not.toHaveBeenCalled();
    }
  );

  it('删除发票把正确 version 原样传入业务层', async () => {
    const invoicesService = { remove: vi.fn().mockResolvedValue(undefined) };
    const dataScopeService = {
      resolveChargerScope: vi.fn().mockResolvedValue(['employee-1']),
    };
    const controller = new InvoicesController(
      invoicesService as never,
      dataScopeService as never,
      {} as never
    );
    const user = {
      id: 'user-1',
      employeeId: 'employee-1',
      roles: ['SALES'],
    };

    await expect(controller.remove('invoice-1', user as never, '4')).resolves.toEqual({
      success: true,
    });
    expect(invoicesService.remove).toHaveBeenCalledWith(
      'invoice-1',
      user,
      ['employee-1'],
      'employee-1',
      4
    );
  });

  it('批量删除把 ids 与逐行 versions 原样传入业务层', async () => {
    const invoicesService = {
      batchRemove: vi.fn().mockResolvedValue({ success: 1, skipped: [] }),
    };
    const dataScopeService = {
      resolveChargerScope: vi.fn().mockResolvedValue(['employee-1']),
    };
    const controller = new InvoicesController(
      invoicesService as never,
      dataScopeService as never,
      {} as never
    );
    const dto = { ids: ['invoice-1'], versions: { 'invoice-1': 6 } };
    const user = {
      id: 'user-1',
      employeeId: 'employee-1',
      roles: ['SALES'],
    };

    await controller.batchRemove(dto as never, user as never);

    expect(invoicesService.batchRemove).toHaveBeenCalledWith(
      dto,
      user,
      ['employee-1'],
      'employee-1'
    );
  });

  it('专用冲红入口继续传递独立 DTO 的 version 与 reason', async () => {
    const result = { id: 'invoice-1', version: 4 };
    const invoicesService = { voidRed: vi.fn().mockResolvedValue(result) };
    const dataScopeService = {
      resolveChargerScope: vi.fn().mockResolvedValue(['employee-1']),
    };
    const controller = new InvoicesController(
      invoicesService as never,
      dataScopeService as never,
      {} as never
    );
    const dto = { version: 3, reason: '原票信息有误' };
    const user = {
      id: 'user-1',
      employeeId: 'employee-1',
      roles: ['SALES'],
    };

    await expect(controller.redVoid('invoice-1', dto, user as never)).resolves.toBe(result);
    expect(invoicesService.voidRed).toHaveBeenCalledWith(
      'invoice-1',
      3,
      '原票信息有误',
      user,
      ['employee-1'],
      'employee-1'
    );
  });
});
