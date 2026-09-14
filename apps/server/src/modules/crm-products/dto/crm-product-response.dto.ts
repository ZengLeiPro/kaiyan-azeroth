import { createPaginatedResponseSchema } from '@ky-azeroth/shared/schemas';
import { crmProductResponseSchema } from '@ky-azeroth/shared/schemas/crm-product';
import { createZodDto } from 'nestjs-zod';

export class CrmProductResponseDto extends createZodDto(crmProductResponseSchema) {}

export class CrmProductListResponseDto extends createZodDto(
  createPaginatedResponseSchema(crmProductResponseSchema)
) {}
