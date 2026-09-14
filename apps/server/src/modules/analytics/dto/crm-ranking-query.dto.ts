import { crmRankingQuerySchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class CrmRankingQueryDto extends createZodDto(crmRankingQuerySchema) {}
