import { batchUpdatePaymentSchema } from '@ky-azeroth/shared/schemas/payment';
import { createZodDto } from 'nestjs-zod';

export class BatchUpdatePaymentDto extends createZodDto(batchUpdatePaymentSchema) {}
