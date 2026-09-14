import { permanentRemoveCustomerSchema } from '@ky-azeroth/shared/schemas/customer';
import { createZodDto } from 'nestjs-zod';

export class PermanentRemoveCustomerDto extends createZodDto(permanentRemoveCustomerSchema) {}
