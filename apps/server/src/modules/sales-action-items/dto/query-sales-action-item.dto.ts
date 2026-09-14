import { querySalesActionItemSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QuerySalesActionItemDto extends createZodDto(querySalesActionItemSchema) {}
