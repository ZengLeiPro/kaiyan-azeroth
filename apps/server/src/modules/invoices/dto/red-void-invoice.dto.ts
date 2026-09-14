import { redVoidInvoiceSchema } from '@ky-azeroth/shared/schemas/invoice';
import { createZodDto } from 'nestjs-zod';

/**
 * 发票冲红 DTO（POST /invoices/:id/red-void body）
 */
export class RedVoidInvoiceDto extends createZodDto(redVoidInvoiceSchema) {}
