import { querySeoSearchTrendSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QuerySeoSearchTrendDto extends createZodDto(querySeoSearchTrendSchema) {}
