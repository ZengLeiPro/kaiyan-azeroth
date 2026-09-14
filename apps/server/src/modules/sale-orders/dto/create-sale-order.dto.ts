import { createSaleOrderSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class CreateSaleOrderDto extends createZodDto(createSaleOrderSchema) {}
