import { batchTransferSaleOrderSchema } from '@ky-azeroth/shared/schemas/sale-order';
import { createZodDto } from 'nestjs-zod';

export class BatchTransferSaleOrderDto extends createZodDto(batchTransferSaleOrderSchema) {}
