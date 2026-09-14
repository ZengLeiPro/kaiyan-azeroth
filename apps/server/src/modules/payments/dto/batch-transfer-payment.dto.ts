import { batchTransferPaymentSchema } from '@ky-azeroth/shared/schemas/payment';
import { createZodDto } from 'nestjs-zod';

export class BatchTransferPaymentDto extends createZodDto(batchTransferPaymentSchema) {}
