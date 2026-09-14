import { updateInvoiceSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class UpdateInvoiceDto extends createZodDto(updateInvoiceSchema) {}
