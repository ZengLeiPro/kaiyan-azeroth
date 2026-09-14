import assert from 'node:assert/strict';
import test from 'node:test';

import type { PrismaClient } from '@prisma/client';

import type { BssClientWrapper } from '../../aliyun/bss-client';
import { syncSnapshot } from '../sync-snapshot';

test('关键数据源部分失败时不覆盖已有快照', async () => {
  const bss = {
    queryAccountBalance: async () => ({
      availableAmount: 100,
      availableCashAmount: 100,
    }),
    queryAccountBill: async () => {
      throw new Error('BSS 暂时不可用');
    },
    describeInstanceBill: async () => [],
    queryResourcePackageInstances: async () => [],
  } as unknown as BssClientWrapper;
  let upsertCalled = false;
  const prisma = {
    cloudBillSnapshot: {
      upsert: async () => {
        upsertCalled = true;
      },
    },
  } as unknown as PrismaClient;

  await assert.rejects(
    syncSnapshot({ bss, prisma, accountId: 'account-1', dryRun: false }),
    /快照关键数据源拉取失败/
  );
  assert.equal(upsertCalled, false);
});
