import { queryActivitySchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryActivityDto extends createZodDto(queryActivitySchema) {}
