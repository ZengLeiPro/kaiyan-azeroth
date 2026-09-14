import { createPaginatedResponseSchema } from '@ky-azeroth/shared/schemas';
import { saleOrderResponseSchema } from '@ky-azeroth/shared/schemas/sale-order';
import { createZodDto } from 'nestjs-zod';

export class SaleOrderResponseDto extends createZodDto(saleOrderResponseSchema) {}

export class SaleOrderListResponseDto extends createZodDto(
  createPaginatedResponseSchema(saleOrderResponseSchema)
) {}
