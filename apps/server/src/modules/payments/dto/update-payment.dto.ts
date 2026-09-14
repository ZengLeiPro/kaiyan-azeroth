import { updatePaymentSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class UpdatePaymentDto extends createZodDto(updatePaymentSchema) {}
