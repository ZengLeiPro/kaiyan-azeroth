import { queryInvoiceSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryInvoiceDto extends createZodDto(queryInvoiceSchema) {}
