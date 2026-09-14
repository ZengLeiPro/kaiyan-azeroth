import { webAnalyticsFunnelQuerySchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryWebAnalyticsFunnelDto extends createZodDto(webAnalyticsFunnelQuerySchema) {}
