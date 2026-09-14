import { financeImportBatchResponseSchema } from '@ky-azeroth/shared/schemas';
import type { FinanceImportBatch } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { mapFinanceImportBatchResponse } from '../finance-import-batch.mapper';

function makeRow(overrides: Partial<FinanceImportBatch> = {}): FinanceImportBatch {
  return {
    id: 'batch-1',
    source: 'dingtalk',
    workbookId: null,
    sheetNames: ['2025'],
    totalRows: 10,
    successRows: 8,
    skippedRows: 1,
    failedRows: 1,
    personalRows: 2,
    status: 'committed',
    previewJson: { byYear: { '2025': [] } },
    summaryJson: null,
    errorReportJson: [],
    reconciliationJson: { passed: true, balanceDiffs: [], pnlDiffs: [] },
    createdAt: new Date('2026-08-24T12:00:00.000Z'),
    creatorEmployeeId: 'employee-1',
    updatedAt: new Date('2026-08-24T13:00:00.000Z'),
    updaterEmployeeId: null,
    deletedAt: null,
    version: 3,
    ...overrides,
  };
}

describe('mapFinanceImportBatchResponse', () => {
  it('maps Prisma Date/Json/audit fields to the shared response contract', () => {
    const response = mapFinanceImportBatchResponse(makeRow());

    expect(response).toMatchObject({
      createdAt: '2026-08-24T12:00:00.000Z',
      creatorEmployeeId: 'employee-1',
      updatedAt: '2026-08-24T13:00:00.000Z',
      updaterEmployeeId: null,
      deletedAt: null,
      version: 3,
      previewJson: { byYear: { '2025': [] } },
      reconciliationJson: { passed: true, balanceDiffs: [], pnlDiffs: [] },
    });
    expect(financeImportBatchResponseSchema.safeParse(response).success).toBe(true);
  });

  it('serializes deletedAt and rejects drifted reconciliation Json', () => {
    expect(
      mapFinanceImportBatchResponse(makeRow({ deletedAt: new Date('2026-08-24T14:00:00.000Z') }))
        .deletedAt
    ).toBe('2026-08-24T14:00:00.000Z');

    expect(() =>
      mapFinanceImportBatchResponse(makeRow({ reconciliationJson: { passed: true } }))
    ).toThrow();
  });
});
