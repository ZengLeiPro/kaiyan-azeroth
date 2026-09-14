import { checkCustomerDuplicateSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class CheckCustomerDuplicateDto extends createZodDto(checkCustomerDuplicateSchema) {}
