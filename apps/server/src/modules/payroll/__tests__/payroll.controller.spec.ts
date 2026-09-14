import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { PayrollController } from '../payroll.controller';
import type { PayrollService } from '../payroll.service';
import type { PayrollImportService } from '../services/payroll-import.service';

describe('PayrollController delete version contract', () => {
  function createController() {
    const payrollService = {
      remove: vi.fn().mockResolvedValue(undefined),
      batchRemove: vi.fn().mockResolvedValue({ success: 2, failed: 0, errors: [] }),
    };
    const payrollImportService = {};
    return {
      controller: new PayrollController(
        payrollService as unknown as PayrollService,
        payrollImportService as PayrollImportService
      ),
      payrollService,
    };
  }

  it.each([undefined, '', '0', '-1', '1.5', 'abc'])(
    'rejects invalid delete version %s before calling the service',
    async (version) => {
      const { controller, payrollService } = createController();

      await expect(
        controller.remove(
          'record-1',
          { id: 'user-1', username: 'tester', roles: [], employeeId: 'employee-1' },
          version
        )
      ).rejects.toThrow(BadRequestException);
      expect(payrollService.remove).not.toHaveBeenCalled();
    }
  );

  it('passes a positive integer version to the service', async () => {
    const { controller, payrollService } = createController();
    const user = { id: 'user-1', username: 'tester', roles: [], employeeId: 'employee-1' };

    await expect(controller.remove('record-1', user, '3')).resolves.toEqual({ success: true });
    expect(payrollService.remove).toHaveBeenCalledWith('record-1', user, 3);
  });

  it('passes ids and row versions through both standard and legacy batch routes', async () => {
    const { controller, payrollService } = createController();
    const user = { id: 'user-1', username: 'tester', roles: [], employeeId: 'employee-1' };
    const dto = {
      ids: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'],
      versions: {
        '11111111-1111-4111-8111-111111111111': 3,
        '22222222-2222-4222-8222-222222222222': 8,
      },
    };

    await controller.batchRemove(dto, user);
    await controller.batchRemoveLegacy(dto, user);

    expect(payrollService.batchRemove).toHaveBeenNthCalledWith(1, dto.ids, dto.versions, user);
    expect(payrollService.batchRemove).toHaveBeenNthCalledWith(2, dto.ids, dto.versions, user);
  });
});
