import assert from 'node:assert/strict';
import test from 'node:test';

import type { PrismaClient } from '@prisma/client';

import type { GoogleClient, GoogleSearchAnalyticsDimension } from '../../clients/google-client';
import { syncGoogle } from '../sync-google';

test('syncGoogle 分别拉取 query、site、page，并写入对应事实表', async () => {
  const requestedDimensions: GoogleSearchAnalyticsDimension[][] = [];
  const google: Pick<GoogleClient, 'querySearchAnalytics'> = {
    querySearchAnalytics: async (_fromDate, _toDate, dimensions = ['query', 'date']) => {
      requestedDimensions.push(dimensions);
      if (dimensions[0] === 'query') {
        return [{ keys: ['示例', '2026-08-26'], clicks: 1, impressions: 10, position: 5 }];
      }
      if (dimensions[0] === 'date') {
        return [{ keys: ['2026-08-26'], clicks: 3, impressions: 100, position: 7 }];
      }
      return [
        {
          keys: ['https://www.example.com/blog/test/', '2026-08-26'],
          clicks: 2,
          impressions: 60,
          position: 6,
        },
      ];
    },
  };
  const queryUpserts: unknown[] = [];
  const performanceUpserts: Array<Record<string, unknown>> = [];
  const prisma = {
    seoSearchQuery: {
      upsert: async (args: unknown) => {
        queryUpserts.push(args);
      },
    },
    seoSearchPerformance: {
      upsert: async (args: Record<string, unknown>) => {
        performanceUpserts.push(args);
      },
    },
  } as unknown as PrismaClient;

  const result = await syncGoogle({
    prisma,
    google,
    siteUrl: 'sc-domain:example.com',
    storageSiteUrl: 'https://www.example.com',
    numOfDays: 3,
    dryRun: false,
    allowEmptyResult: false,
  });

  assert.deepEqual(requestedDimensions, [['query', 'date'], ['date'], ['page', 'date']]);
  assert.equal(queryUpserts.length, 1);
  assert.equal(performanceUpserts.length, 2);
  assert.deepEqual(
    performanceUpserts.map((args) => {
      const create = args.create as Record<string, unknown>;
      return [create.dimension, create.dimensionValue];
    }),
    [
      ['site', '__SITE__'],
      ['page', 'https://www.example.com/blog/test/'],
    ]
  );
  assert.deepEqual(
    {
      fetched: result.fetched,
      written: result.written,
      queryWritten: result.queryWritten,
      siteWritten: result.siteWritten,
      pageWritten: result.pageWritten,
    },
    { fetched: 3, written: 3, queryWritten: 1, siteWritten: 1, pageWritten: 1 }
  );
});

test('syncGoogle 在具名关键词被匿名化但 site 有数据时仍算成功', async () => {
  const google: Pick<GoogleClient, 'querySearchAnalytics'> = {
    querySearchAnalytics: async (_fromDate, _toDate, dimensions = ['query', 'date']) =>
      dimensions[0] === 'date'
        ? [{ keys: ['2026-08-26'], clicks: 2, impressions: 80, position: 8 }]
        : [],
  };
  const prisma = {
    seoSearchQuery: { upsert: async () => undefined },
    seoSearchPerformance: { upsert: async () => undefined },
  } as unknown as PrismaClient;

  const result = await syncGoogle({
    prisma,
    google,
    siteUrl: 'sc-domain:example.com',
    storageSiteUrl: 'https://www.example.com',
    numOfDays: 3,
    dryRun: false,
    allowEmptyResult: false,
  });

  assert.equal(result.queryFetched, 0);
  assert.equal(result.siteWritten, 1);
  assert.equal(result.written, 1);
});
