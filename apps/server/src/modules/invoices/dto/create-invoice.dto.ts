import { createInvoiceSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class CreateInvoiceDto extends createZodDto(createInvoiceSchema) {}
