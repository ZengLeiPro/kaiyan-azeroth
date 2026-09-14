import { querySeoSearchQuerySchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QuerySeoSearchQueryDto extends createZodDto(querySeoSearchQuerySchema) {}
