import { crmTrendQuerySchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class CrmTrendQueryDto extends createZodDto(crmTrendQuerySchema) {}
