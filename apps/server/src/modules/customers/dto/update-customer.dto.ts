import { updateCustomerSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class UpdateCustomerDto extends createZodDto(updateCustomerSchema) {}
