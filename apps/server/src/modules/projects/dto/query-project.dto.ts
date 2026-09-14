import { queryProjectSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryProjectDto extends createZodDto(queryProjectSchema) {}
