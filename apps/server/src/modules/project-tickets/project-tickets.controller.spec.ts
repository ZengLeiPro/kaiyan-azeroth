import { describe, expect, it, vi } from 'vitest';

import type { CurrentUserType } from '../auth/decorators/current-user.decorator';
import { ProjectTicketsController } from './project-tickets.controller';

describe('ProjectTicketsController', () => {
  it('删除工单时把客户端读取的版本号传入业务层', async () => {
    const result = { success: true };
    const service = { remove: vi.fn().mockResolvedValue(result) };
    const controller = new ProjectTicketsController(service as never);
    const actor: CurrentUserType = {
      id: 'employee-1',
      employeeId: 'employee-1',
      username: 'operator',
      roles: ['PM'],
    };

    await expect(controller.remove('ticket-1', { version: 7 }, actor)).resolves.toBe(result);
    expect(service.remove).toHaveBeenCalledWith('ticket-1', 7, actor);
  });
});
