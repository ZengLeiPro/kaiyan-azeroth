import { updateKeepRecordSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class UpdateKeepRecordDto extends createZodDto(updateKeepRecordSchema) {}
