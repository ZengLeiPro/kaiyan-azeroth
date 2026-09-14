import { updateSaleOrderSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class UpdateSaleOrderDto extends createZodDto(updateSaleOrderSchema) {}
