import { createPaginatedResponseSchema } from '@ky-azeroth/shared/schemas';
import { crmWorkDailyResponseSchema } from '@ky-azeroth/shared/schemas/crm-work-daily';
import { createZodDto } from 'nestjs-zod';

export class CrmWorkDailyResponseDto extends createZodDto(crmWorkDailyResponseSchema) {}

export class CrmWorkDailyListResponseDto extends createZodDto(
  createPaginatedResponseSchema(crmWorkDailyResponseSchema)
) {}
