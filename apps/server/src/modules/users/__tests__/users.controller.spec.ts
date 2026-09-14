import { ForbiddenException } from '@nestjs/common';
import { vi } from 'vitest';

import type { CurrentUserType } from '../../auth/decorators/current-user.decorator';
import { UsersController } from '../users.controller';

function user(overrides: Partial<CurrentUserType> = {}): CurrentUserType {
  return {
    id: 'emp-actor',
    employeeId: 'emp-actor',
    username: 'actor',
    roles: ['ADMIN'],
    authType: 'jwt',
    authenticatedAt: new Date(),
    ...overrides,
  };
}

describe('UsersController fresh JWT step-up', () => {
  const service = {
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    updateStatus: vi.fn(),
  };
  const controller = new UsersController(service as never);

  it('rejects PAT for create/update/remove/status before calling the service', () => {
    const pat = user({ authType: 'pat', authenticatedAt: undefined });
    expect(() => controller.create({} as never, pat)).toThrow(ForbiddenException);
    expect(() => controller.update('emp-1', {} as never, pat)).toThrow(ForbiddenException);
    expect(() => controller.remove('emp-1', pat)).toThrow(ForbiddenException);
    expect(() => controller.updateStatus('emp-1', { status: 'disabled' } as never, pat)).toThrow(
      ForbiddenException
    );
    expect(service.create).not.toHaveBeenCalled();
    expect(service.update).not.toHaveBeenCalled();
    expect(service.remove).not.toHaveBeenCalled();
    expect(service.updateStatus).not.toHaveBeenCalled();
  });

  it('accepts a fresh JWT for generic mutations', () => {
    service.remove.mockResolvedValue({ success: true });
    expect(controller.remove('emp-1', user())).toBeInstanceOf(Promise);
    expect(service.remove).toHaveBeenCalledOnce();
  });
});
