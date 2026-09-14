import { createPaginatedResponseSchema } from '@ky-azeroth/shared/schemas';
import { contactResponseSchema } from '@ky-azeroth/shared/schemas/contact';
import { createZodDto } from 'nestjs-zod';

export class ContactResponseDto extends createZodDto(contactResponseSchema) {}

export class ContactListResponseDto extends createZodDto(
  createPaginatedResponseSchema(contactResponseSchema)
) {}
