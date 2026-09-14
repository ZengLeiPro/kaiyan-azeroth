import { createPaymentSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class CreatePaymentDto extends createZodDto(createPaymentSchema) {}
