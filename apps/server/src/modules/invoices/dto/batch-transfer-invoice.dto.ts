import { batchTransferInvoiceSchema } from '@ky-azeroth/shared/schemas/invoice';
import { createZodDto } from 'nestjs-zod';

export class BatchTransferInvoiceDto extends createZodDto(batchTransferInvoiceSchema) {}
