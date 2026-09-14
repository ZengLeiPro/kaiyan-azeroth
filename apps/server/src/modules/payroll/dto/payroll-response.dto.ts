import {
  createPaginatedResponseSchema,
  payrollImportBatchListResponseSchema,
  payrollImportBatchResponseSchema,
  payrollImportCommitResponseSchema,
  payrollImportPreviewResponseSchema,
  payrollPeriodListResponseSchema,
  payrollResponseSchema,
} from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class PayrollResponseDto extends createZodDto(payrollResponseSchema) {}

export class PayrollListResponseDto extends createZodDto(
  createPaginatedResponseSchema(payrollResponseSchema)
) {}

export class PayrollPeriodListResponseDto extends createZodDto(payrollPeriodListResponseSchema) {}

export class PayrollImportPreviewResponseDto extends createZodDto(
  payrollImportPreviewResponseSchema
) {}

export class PayrollImportBatchResponseDto extends createZodDto(payrollImportBatchResponseSchema) {}

export class PayrollImportBatchListResponseDto extends createZodDto(
  payrollImportBatchListResponseSchema
) {}

export class PayrollImportCommitResponseDto extends createZodDto(
  payrollImportCommitResponseSchema
) {}
