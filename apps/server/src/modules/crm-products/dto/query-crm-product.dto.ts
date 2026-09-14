import { queryCrmProductSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryCrmProductDto extends createZodDto(queryCrmProductSchema) {}
