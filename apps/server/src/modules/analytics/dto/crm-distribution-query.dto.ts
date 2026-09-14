import { crmDistributionQuerySchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class CrmDistributionQueryDto extends createZodDto(crmDistributionQuerySchema) {}
