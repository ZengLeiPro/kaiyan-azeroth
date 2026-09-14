import { createPaginatedResponseSchema } from '@ky-azeroth/shared/schemas';
import { paymentResponseSchema } from '@ky-azeroth/shared/schemas/payment';
import { createZodDto } from 'nestjs-zod';

export class PaymentResponseDto extends createZodDto(paymentResponseSchema) {}

export class PaymentListResponseDto extends createZodDto(
  createPaginatedResponseSchema(paymentResponseSchema)
) {}
