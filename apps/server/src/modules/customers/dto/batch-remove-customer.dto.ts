import { batchRemoveCustomerSchema } from '@ky-azeroth/shared/schemas/customer';
import { createZodDto } from 'nestjs-zod';

export class BatchRemoveCustomerDto extends createZodDto(batchRemoveCustomerSchema) {}
