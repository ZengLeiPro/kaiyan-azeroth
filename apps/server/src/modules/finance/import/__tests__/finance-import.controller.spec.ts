import {
  type FinanceImportBatchResponse,
  financeImportBatchResponseSchema,
} from '@ky-azeroth/shared/schemas';
import { describe, expect, it, vi } from 'vitest';

import { QueryFinanceImportBatchDto } from '../dto/query-import-batch.dto';
import { FinanceImportController } from '../finance-import.controller';
import { FinanceImportService } from '../services/finance-import.service';

const batch: FinanceImportBatchResponse = financeImportBatchResponseSchema.parse({
  id: 'batch-1',
  source: 'dingtalk',
  workbookId: 'workbook-1',
  sheetNames: ['2025'],
  totalRows: 2,
  successRows: 2,
  skippedRows: 0,
  failedRows: 0,
  personalRows: 0,
  status: 'committed',
  previewJson: null,
  summaryJson: { totalRows: 2 },
  errorReportJson: [],
  reconciliationJson: { passed: true, balanceDiffs: [], pnlDiffs: [] },
  createdAt: '2026-08-24T12:00:00.000Z',
  creatorEmployeeId: null,
  updatedAt: '2026-08-24T13:00:00.000Z',
  updaterEmployeeId: 'employee-2',
  deletedAt: null,
  version: 2,
});

function makeController() {
  const service = Object.create(FinanceImportService.prototype) as FinanceImportService;
  const listBatches = vi.spyOn(service, 'listBatches');
  const getBatch = vi.spyOn(service, 'getBatch');

  return {
    controller: new FinanceImportController(service),
    service: { listBatches, getBatch },
  };
}

describe('FinanceImportController response contract', () => {
  it('returns the service mapped batch list without controller casts or shape rewrites', async () => {
    const { controller, service } = makeController();
    const response = {
      items: [batch],
      total: 1,
      page: 2,
      pageSize: 5,
      totalPages: 1,
    };
    service.listBatches.mockResolvedValue(response);
    const query = Object.assign(new QueryFinanceImportBatchDto(), {
      page: 2,
      pageSize: 5,
      status: 'committed' as const,
      source: 'dingtalk',
    });

    await expect(controller.listBatches(query)).resolves.toBe(response);
    expect(service.listBatches).toHaveBeenCalledWith(query);
    expect(financeImportBatchResponseSchema.safeParse(response.items[0]).success).toBe(true);
  });

  it('returns the service mapped batch detail unchanged', async () => {
    const { controller, service } = makeController();
    service.getBatch.mockResolvedValue(batch);

    await expect(controller.getBatch('batch-1')).resolves.toBe(batch);
    expect(service.getBatch).toHaveBeenCalledWith('batch-1');
  });
});
