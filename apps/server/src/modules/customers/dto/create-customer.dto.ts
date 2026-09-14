import { createCustomerSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class CreateCustomerDto extends createZodDto(createCustomerSchema) {}
