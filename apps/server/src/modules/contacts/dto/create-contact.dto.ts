import { createContactSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class CreateContactDto extends createZodDto(createContactSchema) {}
