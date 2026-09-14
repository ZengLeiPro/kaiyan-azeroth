import {
  type FinanceImportBatchResponse,
  financeImportBatchResponseSchema,
} from '@ky-azeroth/shared/schemas';
import type { FinanceImportBatch } from '@prisma/client';

/** 将 Prisma 的 Date/Json 批次记录收敛为唯一的 API response 契约。 */
export function mapFinanceImportBatchResponse(row: FinanceImportBatch): FinanceImportBatchResponse {
  return financeImportBatchResponseSchema.parse({
    id: row.id,
    source: row.source,
    workbookId: row.workbookId,
    sheetNames: row.sheetNames,
    totalRows: row.totalRows,
    successRows: row.successRows,
    skippedRows: row.skippedRows,
    failedRows: row.failedRows,
    personalRows: row.personalRows,
    status: row.status,
    previewJson: row.previewJson,
    summaryJson: row.summaryJson,
    errorReportJson: row.errorReportJson,
    reconciliationJson: row.reconciliationJson,
    createdAt: row.createdAt.toISOString(),
    creatorEmployeeId: row.creatorEmployeeId,
    updatedAt: row.updatedAt.toISOString(),
    updaterEmployeeId: row.updaterEmployeeId,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    version: row.version,
  });
}
