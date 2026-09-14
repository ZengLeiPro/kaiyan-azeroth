import { querySystemConfigSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QuerySystemConfigDto extends createZodDto(querySystemConfigSchema) {}
