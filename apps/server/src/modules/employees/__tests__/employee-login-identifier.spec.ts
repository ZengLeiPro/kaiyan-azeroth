import type { Prisma } from '@prisma/client';
import { vi } from 'vitest';

import {
  lockAndAssertEmployeeLoginIdentifiersAvailable,
  normalizeEmployeeLoginIdentifier,
} from '../employee-login-identifier';

describe('employee login identifier lock helper', () => {
  it('normalizes, de-duplicates and locks identifiers in one deterministic order before checking owners', async () => {
    const executeRaw = vi.fn().mockResolvedValue(undefined);
    const findMany = vi.fn().mockResolvedValue([]);
    const tx = {
      $executeRaw: executeRaw,
      employee: { findMany },
    } as unknown as Prisma.TransactionClient;

    await lockAndAssertEmployeeLoginIdentifiersAvailable(
      tx,
      ['  z-user  ', 'a-user', 'z-user', null],
      'emp-self'
    );

    expect(executeRaw.mock.calls.map((call) => call[1])).toEqual([
      'employee_login_identifier:a-user',
      'employee_login_identifier:z-user',
    ]);
    expect(executeRaw).toHaveBeenCalledTimes(2);
    expect(executeRaw.mock.invocationCallOrder[1]).toBeLessThan(
      findMany.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
    );
    expect(findMany).toHaveBeenCalledWith({
      where: {
        id: { not: 'emp-self' },
        OR: [
          { username: 'a-user' },
          { phone: 'a-user' },
          { username: 'z-user' },
          { phone: 'z-user' },
        ],
      },
      select: { id: true, username: true, phone: true, deletedAt: true },
      take: 2,
    });
  });

  it('maps the same normalized identifier from concurrent entry points to the same advisory key', async () => {
    const createTx = () => {
      const executeRaw = vi.fn().mockResolvedValue(undefined);
      return {
        executeRaw,
        tx: {
          $executeRaw: executeRaw,
          employee: { findMany: vi.fn().mockResolvedValue([]) },
        } as unknown as Prisma.TransactionClient,
      };
    };
    const usersEntry = createTx();
    const employeesEntry = createTx();

    await Promise.all([
      lockAndAssertEmployeeLoginIdentifiersAvailable(usersEntry.tx, ['  shared-id '], 'emp-a'),
      lockAndAssertEmployeeLoginIdentifiersAvailable(employeesEntry.tx, ['shared-id'], 'emp-b'),
    ]);

    expect(usersEntry.executeRaw.mock.calls[0]?.[1]).toBe('employee_login_identifier:shared-id');
    expect(employeesEntry.executeRaw.mock.calls[0]?.[1]).toBe(
      'employee_login_identifier:shared-id'
    );
    expect(normalizeEmployeeLoginIdentifier('  shared-id ')).toBe('shared-id');
  });
});
