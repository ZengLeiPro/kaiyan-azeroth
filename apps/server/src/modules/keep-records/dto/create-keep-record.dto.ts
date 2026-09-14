import { createKeepRecordSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class CreateKeepRecordDto extends createZodDto(createKeepRecordSchema) {}
