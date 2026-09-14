import { batchUpdateCustomerSchema } from '@ky-azeroth/shared/schemas/customer';
import { createZodDto } from 'nestjs-zod';

export class BatchUpdateCustomerDto extends createZodDto(batchUpdateCustomerSchema) {}
