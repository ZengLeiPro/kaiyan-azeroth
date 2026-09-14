import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  type FinanceImportBatchResponse,
  financeImportBatchResponseSchema,
} from '../finance-import';

const validBatch = {
  id: 'batch-1',
  source: 'dingtalk',
  workbookId: null,
  sheetNames: ['2025'],
  totalRows: 10,
  successRows: 8,
  skippedRows: 1,
  failedRows: 1,
  personalRows: 2,
  status: 'committed' as const,
  previewJson: { byYear: { '2025': [] } },
  summaryJson: null,
  errorReportJson: [],
  reconciliationJson: {
    passed: true,
    balanceDiffs: [],
    pnlDiffs: [],
  },
  createdAt: '2026-08-24T12:00:00.000Z',
  creatorEmployeeId: 'employee-1',
  updatedAt: '2026-08-24T13:00:00.000Z',
  updaterEmployeeId: null,
  deletedAt: null,
  version: 3,
};

describe('financeImportBatchResponseSchema', () => {
  it('defines the complete Date/Json/audit API contract', () => {
    const parsed = financeImportBatchResponseSchema.parse(validBatch);

    expect(parsed).toEqual(validBatch);
    expectTypeOf(parsed).toEqualTypeOf<FinanceImportBatchResponse>();
  });

  it.each([
    'createdAt',
    'creatorEmployeeId',
    'updatedAt',
    'updaterEmployeeId',
    'deletedAt',
    'version',
  ] as const)('requires %s to be present', (field) => {
    const input: Partial<typeof validBatch> = { ...validBatch };
    delete input[field];

    expect(financeImportBatchResponseSchema.safeParse(input).success).toBe(false);
  });

  it('rejects Date objects, undefined Json fields, and malformed reconciliation Json', () => {
    expect(
      financeImportBatchResponseSchema.safeParse({
        ...validBatch,
        createdAt: new Date(validBatch.createdAt),
      }).success
    ).toBe(false);
    expect(
      financeImportBatchResponseSchema.safeParse({ ...validBatch, previewJson: undefined }).success
    ).toBe(false);
    expect(
      financeImportBatchResponseSchema.safeParse({
        ...validBatch,
        reconciliationJson: { passed: true },
      }).success
    ).toBe(false);
  });
});
