import { batchTransferCustomerSchema } from '@ky-azeroth/shared/schemas/customer';
import { createZodDto } from 'nestjs-zod';

export class BatchTransferCustomerDto extends createZodDto(batchTransferCustomerSchema) {}
