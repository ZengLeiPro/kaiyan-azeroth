import { createSalesActionItemSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class CreateSalesActionItemDto extends createZodDto(createSalesActionItemSchema) {}
