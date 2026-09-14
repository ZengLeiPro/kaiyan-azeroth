import { vi } from 'vitest';

import { CrmChangeLogService } from '../crm-change-log.service';
import type { OperationLogsService } from '../operation-logs.service';

describe('CrmChangeLogService', () => {
  function createService() {
    const operationLogsService = {
      log: vi.fn().mockResolvedValue({ id: 'log-1' }),
    } as unknown as OperationLogsService;
    return {
      service: new CrmChangeLogService(operationLogsService),
      log: operationLogsService.log as ReturnType<typeof vi.fn>,
    };
  }

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should write field-level change logs and ignore system/relation fields', async () => {
    const { service, log } = createService();

    await service.logChange({
      module: 'customers',
      action: 'update',
      target: 'customer-1',
      targetName: '示例科技',
      currentUser: { id: 'user-1', employeeId: 'emp-1' },
      before: {
        id: 'customer-1',
        customerName: '旧客户名',
        version: 1,
        charger: { id: 'emp-old', name: '旧负责人' },
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      after: {
        id: 'customer-1',
        customerName: '新客户名',
        version: 2,
        charger: { id: 'emp-new', name: '新负责人' },
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      },
    });

    expect(log).toHaveBeenCalledWith({
      employeeId: 'emp-1',
      module: 'customers',
      action: 'update',
      target: 'customer-1',
      // 2026-06-16 投影改造：module='customers' 时 targetCustomerId = target
      targetCustomerId: 'customer-1',
      details: {
        kind: 'change',
        targetName: '示例科技',
        before: { customerName: '旧客户名' },
        after: { customerName: '新客户名' },
        changes: [
          {
            field: 'customerName',
            label: '客户名称',
            before: '旧客户名',
            after: '新客户名',
          },
        ],
      },
    });
  });

  it('should skip update logs when no business field changed', async () => {
    const { service, log } = createService();

    await service.logChange({
      module: 'customers',
      action: 'update',
      target: 'customer-1',
      currentUser: { id: 'user-1' },
      before: { id: 'customer-1', version: 1, customerName: '示例科技' },
      after: { id: 'customer-1', version: 2, customerName: '示例科技' },
    });

    expect(log).not.toHaveBeenCalled();
  });

  it('should display charger names and ignore relation arrays', async () => {
    const { service, log } = createService();

    await service.logChange({
      module: 'customers',
      action: 'update',
      target: 'customer-1',
      currentUser: { id: 'user-1' },
      before: {
        chargerId: 'emp-old',
        chargerName: '旧负责人',
        contacts: [{ id: 'contact-1', contactName: '联系人A' }],
      },
      after: {
        chargerId: 'emp-new',
        chargerName: '新负责人',
        contacts: [{ id: 'contact-2', contactName: '联系人B' }],
      },
    });

    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          before: { chargerId: '旧负责人' },
          after: { chargerId: '新负责人' },
          changes: [
            {
              field: 'chargerId',
              label: '负责人',
              before: '旧负责人',
              after: '新负责人',
            },
          ],
        }),
      })
    );
  });

  it('should normalize decimal-like values inside array details', async () => {
    const { service, log } = createService();
    const quantity = {
      constructor: () => undefined,
      toNumber: () => 10,
      toString: () => '10',
      s: 1,
      e: 1,
      d: [10],
    };

    await service.logChange({
      module: 'opportunities',
      action: 'create',
      target: 'opp-1',
      targetName: '测试商机',
      currentUser: { id: 'user-1' },
      after: {
        opportunityName: '测试商机',
        products: [{ productName: '产品A', quantity }],
      },
    });

    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          after: expect.objectContaining({
            products: [{ productName: '产品A', quantity: 10 }],
          }),
          changes: expect.arrayContaining([
            expect.objectContaining({
              field: 'products',
              after: [{ productName: '产品A', quantity: 10 }],
            }),
          ]),
        }),
      })
    );
  });
});
