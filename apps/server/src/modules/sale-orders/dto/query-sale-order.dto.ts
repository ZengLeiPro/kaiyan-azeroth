import { querySaleOrderSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QuerySaleOrderDto extends createZodDto(querySaleOrderSchema) {}
