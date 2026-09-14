import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/** Normalize values before both persistence and lock-key construction. */
export function normalizeEmployeeLoginIdentifier(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

/**
 * Serialize every Employee username/phone writer on the same cross-column namespace,
 * then reject ownership by any other row. Soft-deleted rows deliberately keep their
 * historical identifiers reserved so an identity cannot silently change subjects.
 */
export async function lockEmployeeLoginIdentifiers(
  tx: Prisma.TransactionClient,
  values: readonly (string | null | undefined)[]
): Promise<string[]> {
  const identifiers = [
    ...new Set(
      values
        .map((value) => normalizeEmployeeLoginIdentifier(value))
        .filter((value): value is string => value !== null)
    ),
  ].sort();

  for (const identifier of identifiers) {
    const lockKey = `employee_login_identifier:${identifier}`;
    // @prisma-raw-sql: transaction advisory locks provide one shared cross-column namespace for all username/phone writers.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
  }

  return identifiers;
}

/**
 * Lock identifiers and reject ownership by any other Employee row. Soft-deleted rows
 * deliberately keep their historical identifiers reserved.
 */
export async function lockAndAssertEmployeeLoginIdentifiersAvailable(
  tx: Prisma.TransactionClient,
  values: readonly (string | null | undefined)[],
  employeeId?: string
): Promise<string[]> {
  const identifiers = await lockEmployeeLoginIdentifiers(tx, values);
  if (identifiers.length === 0) return identifiers;

  const owners = await tx.employee.findMany({
    where: {
      ...(employeeId ? { id: { not: employeeId } } : {}),
      OR: identifiers.flatMap((identifier) => [{ username: identifier }, { phone: identifier }]),
    },
    select: { id: true, username: true, phone: true, deletedAt: true },
    take: 2,
  });

  if (owners.length > 0) {
    throw new ConflictException('用户名或手机号已被其他员工占用');
  }

  return identifiers;
}
