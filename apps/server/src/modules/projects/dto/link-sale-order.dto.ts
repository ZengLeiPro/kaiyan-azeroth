import { linkSaleOrderSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class LinkSaleOrderDto extends createZodDto(linkSaleOrderSchema) {}
