import { updateVisitRecordSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class UpdateVisitRecordDto extends createZodDto(updateVisitRecordSchema) {}
