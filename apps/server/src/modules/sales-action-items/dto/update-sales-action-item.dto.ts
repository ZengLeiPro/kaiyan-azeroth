import { updateSalesActionItemSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class UpdateSalesActionItemDto extends createZodDto(updateSalesActionItemSchema) {}
