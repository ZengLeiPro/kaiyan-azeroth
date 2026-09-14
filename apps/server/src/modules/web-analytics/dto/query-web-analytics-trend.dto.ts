import { webAnalyticsTrendQuerySchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryWebAnalyticsTrendDto extends createZodDto(webAnalyticsTrendQuerySchema) {}
