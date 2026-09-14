import { queryLoginLogSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryLoginLogDto extends createZodDto(queryLoginLogSchema) {}
