import { queryContactSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryContactDto extends createZodDto(queryContactSchema) {}
