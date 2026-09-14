import { queryTablePreferenceSchema } from '@ky-azeroth/shared/schemas/table-preference';
import { createZodDto } from 'nestjs-zod';

export class QueryTablePreferenceDto extends createZodDto(queryTablePreferenceSchema) {}
