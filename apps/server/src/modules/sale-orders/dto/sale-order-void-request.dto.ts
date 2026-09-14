import { saleOrderVoidRequestSchema } from '@ky-azeroth/shared/schemas/sale-order';
import { createZodDto } from 'nestjs-zod';

export class SaleOrderVoidRequestDto extends createZodDto(saleOrderVoidRequestSchema) {}
