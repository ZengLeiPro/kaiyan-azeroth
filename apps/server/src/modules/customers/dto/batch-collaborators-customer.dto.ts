import { batchCollaboratorsCustomerSchema } from '@ky-azeroth/shared/schemas/customer';
import { createZodDto } from 'nestjs-zod';

export class BatchCollaboratorsCustomerDto extends createZodDto(batchCollaboratorsCustomerSchema) {}
