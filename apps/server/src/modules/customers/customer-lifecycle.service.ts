import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import {
  recomputeCustomerLifecycle,
  type RecomputeCustomerLifecycleOptions,
} from './customer-lifecycle';

/**
 * Customer lifecycle orchestration boundary shared by customer and fact modules.
 *
 * It deliberately depends only on Prisma and the leaf domain helper. Fact writers can therefore
 * recompute derived customer state in their existing transaction without importing CustomersService.
 */
@Injectable()
export class CustomerLifecycleService {
  constructor(private readonly prisma: PrismaService) {}

  async recompute(
    customerIds: string | readonly string[],
    options: RecomputeCustomerLifecycleOptions,
    prisma?: PrismaService | Prisma.TransactionClient
  ): Promise<void> {
    if (prisma) {
      await recomputeCustomerLifecycle(prisma as Prisma.TransactionClient, customerIds, options);
      return;
    }
    await this.prisma.$transaction((tx) => recomputeCustomerLifecycle(tx, customerIds, options));
  }

  async refresh(
    customerIds: string | readonly string[],
    actor: { id: string; employeeId?: string | null },
    prisma?: PrismaService | Prisma.TransactionClient
  ): Promise<void> {
    await this.recompute(customerIds, { syncLeadProgress: true, actor }, prisma);
  }
}
