import { ForbiddenException } from '@nestjs/common';
import { vi } from 'vitest';

import { SalesActionItemsController } from '../sales-action-items.controller';

describe('SalesActionItemsController', () => {
  let controller: SalesActionItemsController;
  let service: {
    findMine: ReturnType<typeof vi.fn>;
    countMine: ReturnType<typeof vi.fn>;
    adopt: ReturnType<typeof vi.fn>;
    ignore: ReturnType<typeof vi.fn>;
    done: ReturnType<typeof vi.fn>;
    transfer: ReturnType<typeof vi.fn>;
    reopen: ReturnType<typeof vi.fn>;
    undo: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    findAll: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  let dataScopeService: { resolveChargerScope: ReturnType<typeof vi.fn> };

  const user = {
    id: 'emp-1',
    employeeId: 'emp-1',
    roles: ['SALES'],
  };

  beforeEach(() => {
    service = {
      findMine: vi.fn().mockResolvedValue({ items: [] }),
      countMine: vi.fn().mockResolvedValue({ count: 2 }),
      adopt: vi.fn().mockResolvedValue({ id: 'action-1', status: 'adopted' }),
      ignore: vi.fn().mockResolvedValue({ id: 'action-1', status: 'ignored' }),
      done: vi.fn().mockResolvedValue({ id: 'action-1', status: 'done' }),
      transfer: vi.fn().mockResolvedValue({ id: 'action-2', status: 'pending' }),
      reopen: vi.fn().mockResolvedValue({ id: 'action-1', status: 'pending' }),
      undo: vi.fn().mockResolvedValue({ id: 'action-1', status: 'pending' }),
      create: vi.fn().mockResolvedValue({ id: 'action-1' }),
      findAll: vi.fn().mockResolvedValue({ items: [] }),
      findOne: vi.fn().mockResolvedValue({ id: 'action-1' }),
      update: vi.fn().mockResolvedValue({ id: 'action-1' }),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    dataScopeService = {
      resolveChargerScope: vi.fn().mockResolvedValue(['emp-1']),
    };
    controller = new SalesActionItemsController(service as never, dataScopeService as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should route mine endpoints to current employee id', async () => {
    const query = { category: ['FOLLOW_UP_DUE'] };
    const request = { query: { filters: { status: ['pending'] } } };

    await controller.findMine(query as never, user as never, request as never);
    await controller.countMine(query as never, user as never);

    expect(service.findMine).toHaveBeenCalledWith(query, 'emp-1', request.query);
    expect(service.countMine).toHaveBeenCalledWith('emp-1', ['FOLLOW_UP_DUE']);
  });

  it('should resolve scope for action endpoints', async () => {
    await controller.adopt('action-1', user as never);
    await controller.ignore('action-1', { resolveNote: '暂不跟进' } as never, user as never);
    await controller.done(
      'action-1',
      { resolveNote: '已处理', doneType: 'other', keepRecord: undefined } as never,
      user as never
    );
    await controller.reopen('action-1', user as never);
    await controller.undo('action-1', user as never);

    expect(service.adopt).toHaveBeenCalledWith('action-1', user, ['emp-1']);
    expect(service.ignore).toHaveBeenCalledWith('action-1', '暂不跟进', user, ['emp-1']);
    expect(service.done).toHaveBeenCalledWith(
      'action-1',
      '已处理',
      'other',
      user,
      ['emp-1'],
      undefined
    );
    expect(service.reopen).toHaveBeenCalledWith('action-1', user, ['emp-1']);
    expect(service.undo).toHaveBeenCalledWith('action-1', user, false, ['emp-1']);
  });

  it('should allow admin to create action items for any employee', async () => {
    const admin = { ...user, roles: ['ADMIN'] };
    dataScopeService.resolveChargerScope.mockResolvedValue(null);

    await controller.create({ employeeId: 'emp-2' } as never, admin as never);

    expect(service.create).toHaveBeenCalledWith({ employeeId: 'emp-2' }, admin);
  });

  it('should allow all-scope users to transfer action items', async () => {
    const manager = { ...user, roles: ['CRM_MANAGER'] };
    dataScopeService.resolveChargerScope.mockResolvedValue(null);

    await controller.transfer(
      'action-1',
      { targetEmployeeId: 'emp-2', reason: '客户已转给郑销售' } as never,
      manager as never
    );

    expect(service.transfer).toHaveBeenCalledWith(
      'action-1',
      'emp-2',
      '客户已转给郑销售',
      manager,
      null
    );
  });

  it('should reject self-scope users transferring action items', async () => {
    await expect(
      controller.transfer(
        'action-1',
        { targetEmployeeId: 'emp-2', reason: '不归我' } as never,
        user as never
      )
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(service.transfer).not.toHaveBeenCalled();
  });

  it('should reject creating action items outside non-admin scope', async () => {
    await expect(
      controller.create({ employeeId: 'emp-2' } as never, user as never)
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(service.create).not.toHaveBeenCalled();
  });

  it('should reject huge pageSize when viewScope is not ALL', async () => {
    await expect(
      controller.findAll({ pageSize: 501 } as never, user as never, { query: {} } as never)
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(dataScopeService.resolveChargerScope).toHaveBeenCalledOnce();
    expect(service.findAll).not.toHaveBeenCalled();
  });

  it('should route standard CRUD endpoints with resolved scope', async () => {
    const request = { query: { keyword: '跟进' } };

    await controller.findAll({ pageSize: 20 } as never, user as never, request as never);
    await controller.findOne('action-1', user as never);
    await controller.update('action-1', { title: '新标题' } as never, user as never);
    const removed = await controller.remove('action-1', user as never);

    expect(service.findAll).toHaveBeenCalledWith(
      { pageSize: 20 },
      ['emp-1'],
      undefined,
      request.query
    );
    expect(service.findOne).toHaveBeenCalledWith('action-1', ['emp-1']);
    expect(service.update).toHaveBeenCalledWith('action-1', { title: '新标题' }, user, ['emp-1']);
    expect(service.remove).toHaveBeenCalledWith('action-1', user, ['emp-1']);
    expect(removed).toEqual({ success: true });
  });
});
