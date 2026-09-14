import { createPaginatedResponseSchema } from '@ky-azeroth/shared/schemas';
import { invoiceResponseSchema } from '@ky-azeroth/shared/schemas/invoice';
import { createZodDto } from 'nestjs-zod';

export class InvoiceResponseDto extends createZodDto(invoiceResponseSchema) {}

export class InvoiceListResponseDto extends createZodDto(
  createPaginatedResponseSchema(invoiceResponseSchema)
) {}
