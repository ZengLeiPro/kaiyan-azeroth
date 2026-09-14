import { queryWebEventSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryWebEventDto extends createZodDto(queryWebEventSchema) {}
