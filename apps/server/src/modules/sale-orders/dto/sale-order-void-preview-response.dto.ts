import { saleOrderVoidPreviewSchema } from '@ky-azeroth/shared/schemas/sale-order';
import { createZodDto } from 'nestjs-zod';

export class SaleOrderVoidPreviewResponseDto extends createZodDto(saleOrderVoidPreviewSchema) {}
