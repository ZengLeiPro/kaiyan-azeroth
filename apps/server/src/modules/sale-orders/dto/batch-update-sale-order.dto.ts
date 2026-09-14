import { batchUpdateSaleOrderSchema } from '@ky-azeroth/shared/schemas/sale-order';
import { createZodDto } from 'nestjs-zod';

export class BatchUpdateSaleOrderDto extends createZodDto(batchUpdateSaleOrderSchema) {}
