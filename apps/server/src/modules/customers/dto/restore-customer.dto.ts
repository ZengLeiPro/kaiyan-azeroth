import { restoreCustomerSchema } from '@ky-azeroth/shared/schemas/customer';
import { createZodDto } from 'nestjs-zod';

export class RestoreCustomerDto extends createZodDto(restoreCustomerSchema) {}
