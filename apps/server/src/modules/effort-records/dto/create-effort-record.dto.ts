import { createEffortRecordSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class CreateEffortRecordDto extends createZodDto(createEffortRecordSchema) {}
