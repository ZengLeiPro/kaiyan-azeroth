import { ForbiddenException } from '@nestjs/common';
import { vi } from 'vitest';

import type { CurrentUserType } from './decorators/current-user.decorator';
import { PatController } from './pat.controller';

function admin(overrides: Partial<CurrentUserType> = {}): CurrentUserType {
  return {
    id: 'emp-admin',
    employeeId: 'emp-admin',
    username: 'operator',
    roles: ['ADMIN'],
    authType: 'jwt',
    authenticatedAt: new Date(),
    ...overrides,
  };
}

describe('PatController fresh JWT step-up', () => {
  const service = {
    issueByEmployeeId: vi.fn(),
    revoke: vi.fn(),
    listAll: vi.fn(),
    listByEmployee: vi.fn(),
  };
  const controller = new PatController(service as never);

  it('rejects ADMIN PAT authentication for issue and revoke', async () => {
    const pat = admin({ authType: 'pat', authenticatedAt: undefined });
    await expect(
      controller.issue(pat, { employeeId: 'emp-1', name: 'agent' } as never)
    ).rejects.toThrow(ForbiddenException);
    await expect(controller.revoke(pat, 'pat-1')).rejects.toThrow(ForbiddenException);
    expect(service.issueByEmployeeId).not.toHaveBeenCalled();
    expect(service.revoke).not.toHaveBeenCalled();
  });

  it('passes currentUser to revoke under a fresh JWT', async () => {
    service.revoke.mockResolvedValue(undefined);
    const actor = admin();
    await expect(controller.revoke(actor, 'pat-1')).resolves.toEqual({ ok: true });
    expect(service.revoke).toHaveBeenCalledWith('pat-1', actor);
  });
});
