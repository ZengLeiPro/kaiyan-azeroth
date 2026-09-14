import { removeCustomerQuerySchema } from '@ky-azeroth/shared/schemas/customer';
import { createZodDto } from 'nestjs-zod';

export class RemoveCustomerQueryDto extends createZodDto(removeCustomerQuerySchema) {}
