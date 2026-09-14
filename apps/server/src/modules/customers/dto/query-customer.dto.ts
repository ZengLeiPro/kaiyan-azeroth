import { queryCustomerSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryCustomerDto extends createZodDto(queryCustomerSchema) {}
