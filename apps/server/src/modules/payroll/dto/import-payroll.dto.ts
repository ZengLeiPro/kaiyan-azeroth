import {
  batchPayrollDeleteSchema,
  payrollImportCommitSchema,
  payrollImportPreviewInputSchema,
} from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class PayrollImportPreviewDto extends createZodDto(payrollImportPreviewInputSchema) {}

export class PayrollImportCommitDto extends createZodDto(payrollImportCommitSchema) {}

export class BatchPayrollDeleteDto extends createZodDto(batchPayrollDeleteSchema) {}
