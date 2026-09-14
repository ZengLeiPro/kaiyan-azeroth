import { batchUpdateInvoiceSchema } from '@ky-azeroth/shared/schemas/invoice';
import { createZodDto } from 'nestjs-zod';

export class BatchUpdateInvoiceDto extends createZodDto(batchUpdateInvoiceSchema) {}
