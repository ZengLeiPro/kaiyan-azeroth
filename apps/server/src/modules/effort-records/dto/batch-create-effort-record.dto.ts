import { batchCreateEffortRecordSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class BatchCreateEffortRecordDto extends createZodDto(batchCreateEffortRecordSchema) {}
