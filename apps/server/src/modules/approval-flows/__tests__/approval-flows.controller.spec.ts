import { vi } from 'vitest';

import { ApprovalFlowsController } from '../approval-flows.controller';

describe('ApprovalFlowsController', () => {
  let controller: ApprovalFlowsController;
  let service: {
    create: ReturnType<typeof vi.fn>;
    findAll: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
    findActiveByEventType: ReturnType<typeof vi.fn>;
    findVersionHistory: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    enableModule: ReturnType<typeof vi.fn>;
    disableModule: ReturnType<typeof vi.fn>;
    activateVersion: ReturnType<typeof vi.fn>;
    deactivateFlow: ReturnType<typeof vi.fn>;
  };
  let guardService: {
    getAllModuleStatus: ReturnType<typeof vi.fn>;
    isRequired: ReturnType<typeof vi.fn>;
  };

  const user = { id: 'user-1', employeeId: 'emp-1' };

  beforeEach(() => {
    service = {
      create: vi.fn().mockResolvedValue({ id: 'flow-1' }),
      findAll: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
      findOne: vi.fn().mockResolvedValue({ id: 'flow-1' }),
      findActiveByEventType: vi.fn().mockResolvedValue({ id: 'flow-1', status: 'active' }),
      findVersionHistory: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({ id: 'flow-2' }),
      remove: vi.fn().mockResolvedValue({ success: true }),
      enableModule: vi.fn().mockResolvedValue({ enabled: true, hasFlow: true }),
      disableModule: vi.fn().mockResolvedValue({ disabled: true, count: 1 }),
      activateVersion: vi.fn().mockResolvedValue({ id: 'flow-1', status: 'active' }),
      deactivateFlow: vi.fn().mockResolvedValue({ id: 'flow-1', status: 'inactive' }),
    };
    guardService = {
      getAllModuleStatus: vi.fn().mockResolvedValue([]),
      isRequired: vi.fn().mockResolvedValue(true),
    };
    controller = new ApprovalFlowsController(service as never, guardService as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('create 应转发 dto 与当前用户到 service', async () => {
    const dto = { name: '请假审批', eventType: 'leave_request' } as never;
    await controller.create(dto, user as never);
    expect(service.create).toHaveBeenCalledWith(dto, user);
  });

  it('getModuleStatus 应转发到 guardService', async () => {
    await controller.getModuleStatus();
    expect(guardService.getAllModuleStatus).toHaveBeenCalled();
  });

  it('checkApprovalRequired 应组合 eventType + required 返回', async () => {
    guardService.isRequired.mockResolvedValueOnce(true);
    const result = await controller.checkApprovalRequired('leave_request');
    expect(result).toEqual({ eventType: 'leave_request', required: true });
    expect(guardService.isRequired).toHaveBeenCalledWith('leave_request');
  });

  it('findAll 应把 raw request.query 一并透传给 service（供 filter-scheme 使用）', async () => {
    const query = { page: 1, pageSize: 20 } as never;
    const request = { query: { filters: { status: ['active'] } } };
    await controller.findAll(query, request as never);
    expect(service.findAll).toHaveBeenCalledWith(query, request.query);
  });

  it('enableModule 应转发 eventType 到 service', async () => {
    await controller.enableModule('leave_request');
    expect(service.enableModule).toHaveBeenCalledWith('leave_request');
  });

  it('disableModule 应转发 eventType 到 service', async () => {
    await controller.disableModule('leave_request');
    expect(service.disableModule).toHaveBeenCalledWith('leave_request');
  });

  it('findActiveByEventType 应转发 eventType 到 service', async () => {
    await controller.findActiveByEventType('leave_request');
    expect(service.findActiveByEventType).toHaveBeenCalledWith('leave_request');
  });

  it('findVersionHistory 应转发 groupId 到 service', async () => {
    await controller.findVersionHistory('group-1');
    expect(service.findVersionHistory).toHaveBeenCalledWith('group-1');
  });

  it('findOne 应转发 id 到 service', async () => {
    await controller.findOne('flow-1');
    expect(service.findOne).toHaveBeenCalledWith('flow-1');
  });

  it('update 应转发 id/dto/user 到 service', async () => {
    const dto = { name: '新名称' } as never;
    await controller.update('flow-1', dto, user as never);
    expect(service.update).toHaveBeenCalledWith('flow-1', dto, user);
  });

  it('activateVersion 应转发 id 到 service', async () => {
    await controller.activateVersion('flow-1');
    expect(service.activateVersion).toHaveBeenCalledWith('flow-1');
  });

  it('deactivateFlow 应转发 id 与当前用户到 service', async () => {
    await controller.deactivateFlow('flow-1', user as never);
    expect(service.deactivateFlow).toHaveBeenCalledWith('flow-1', user);
  });

  it('remove 应转发 id 与当前用户到 service', async () => {
    await controller.remove('flow-1', user as never);
    expect(service.remove).toHaveBeenCalledWith('flow-1', user);
  });
});
