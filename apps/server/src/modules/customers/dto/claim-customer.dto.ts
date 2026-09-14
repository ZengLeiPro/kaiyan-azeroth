import { claimCustomerSchema } from '@ky-azeroth/shared/schemas/customer';
import { createZodDto } from 'nestjs-zod';

export class ClaimCustomerDto extends createZodDto(claimCustomerSchema) {}
