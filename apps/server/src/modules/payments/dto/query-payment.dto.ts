import { queryPaymentSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryPaymentDto extends createZodDto(queryPaymentSchema) {}
