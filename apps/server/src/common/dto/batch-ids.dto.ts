import { batchIdsSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class BatchIdsDto extends createZodDto(batchIdsSchema) {}
