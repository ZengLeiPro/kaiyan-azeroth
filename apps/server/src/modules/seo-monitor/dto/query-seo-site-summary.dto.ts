import { querySeoSiteSummarySchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QuerySeoSiteSummaryDto extends createZodDto(querySeoSiteSummarySchema) {}
