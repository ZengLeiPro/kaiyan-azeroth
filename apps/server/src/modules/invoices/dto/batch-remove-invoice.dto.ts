import { batchRemoveInvoiceSchema } from '@ky-azeroth/shared/schemas/invoice';
import { createZodDto } from 'nestjs-zod';

export class BatchRemoveInvoiceDto extends createZodDto(batchRemoveInvoiceSchema) {}
