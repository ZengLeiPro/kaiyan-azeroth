import { batchRemovePaymentSchema } from '@ky-azeroth/shared/schemas/payment';
import { createZodDto } from 'nestjs-zod';

export class BatchRemovePaymentDto extends createZodDto(batchRemovePaymentSchema) {}
