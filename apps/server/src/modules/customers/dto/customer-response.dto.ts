import { createPaginatedResponseSchema } from '@ky-azeroth/shared/schemas';
import {
  customerDuplicateCheckResponseSchema,
  customerResponseSchema,
} from '@ky-azeroth/shared/schemas/customer';
import { createZodDto } from 'nestjs-zod';

export class CustomerResponseDto extends createZodDto(customerResponseSchema) {}

export class CustomerListResponseDto extends createZodDto(
  createPaginatedResponseSchema(customerResponseSchema)
) {}

export class CustomerDuplicateCheckResponseDto extends createZodDto(
  customerDuplicateCheckResponseSchema
) {}
