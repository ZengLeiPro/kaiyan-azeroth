import { describe, expect, it, vi } from 'vitest';

import type { CurrentUserType } from '../../auth/decorators/current-user.decorator';
import { ProjectsController } from '../projects.controller';

function actor(): CurrentUserType {
  return {
    id: 'employee-1',
    employeeId: 'employee-1',
    username: 'operator',
    roles: ['PM'],
  };
}

describe('ProjectsController', () => {
  it('删除项目时把客户端读取的版本号传入业务层', async () => {
    const result = { success: true };
    const service = { remove: vi.fn().mockResolvedValue(result) };
    const controller = new ProjectsController(service as never);
    const user = actor();

    await expect(controller.remove('project-1', { version: 4 }, user)).resolves.toBe(result);
    expect(service.remove).toHaveBeenCalledWith('project-1', 4, user);
  });

  it('关联和解除订单时都携带项目版本，避免覆盖并发更新', async () => {
    const linked = { id: 'project-1', version: 6 };
    const unlinked = { success: true };
    const service = {
      linkSaleOrder: vi.fn().mockResolvedValue(linked),
      unlinkSaleOrder: vi.fn().mockResolvedValue(unlinked),
    };
    const controller = new ProjectsController(service as never);
    const user = actor();

    await expect(
      controller.linkSaleOrder('project-1', { saleOrderId: 'order-1', version: 5 }, user)
    ).resolves.toBe(linked);
    await expect(
      controller.unlinkSaleOrder('project-1', 'order-1', { version: 6 }, user)
    ).resolves.toBe(unlinked);
    expect(service.linkSaleOrder).toHaveBeenCalledWith('project-1', 'order-1', 5, user);
    expect(service.unlinkSaleOrder).toHaveBeenCalledWith('project-1', 'order-1', 6, user);
  });

  it('成员增删携带操作者和项目版本，并序列化响应日期', async () => {
    const joinedAt = new Date('2026-09-04T00:00:00.000Z');
    const member = { id: 'member-1', projectId: 'project-1', joinedAt };
    const service = {
      addMember: vi.fn().mockResolvedValue(member),
      removeMember: vi.fn().mockResolvedValue({ success: true }),
    };
    const controller = new ProjectsController(service as never);
    const user = actor();
    const body = { employeeId: 'employee-2', role: 'developer' };

    await expect(controller.addMember('project-1', body as never, user)).resolves.toEqual({
      ...member,
      joinedAt: joinedAt.toISOString(),
    });
    await expect(
      controller.removeMember('project-1', 'member-1', { version: 3 }, user)
    ).resolves.toEqual({ success: true });
    expect(service.addMember).toHaveBeenCalledWith('project-1', body, user);
    expect(service.removeMember).toHaveBeenCalledWith('project-1', 'member-1', 3, user);
  });
});
