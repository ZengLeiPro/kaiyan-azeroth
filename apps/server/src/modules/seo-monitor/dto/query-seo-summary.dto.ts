import { querySeoSummarySchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QuerySeoSummaryDto extends createZodDto(querySeoSummarySchema) {}
