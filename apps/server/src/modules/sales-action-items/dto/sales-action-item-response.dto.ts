import { createPaginatedResponseSchema } from '@ky-azeroth/shared/schemas';
import { salesActionItemResponseSchema } from '@ky-azeroth/shared/schemas/sales-action-item';
import { createZodDto } from 'nestjs-zod';

export class SalesActionItemResponseDto extends createZodDto(salesActionItemResponseSchema) {}

export class SalesActionItemListResponseDto extends createZodDto(
  createPaginatedResponseSchema(salesActionItemResponseSchema)
) {}
