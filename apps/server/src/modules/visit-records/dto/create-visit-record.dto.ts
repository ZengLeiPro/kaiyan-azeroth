import { createVisitRecordSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class CreateVisitRecordDto extends createZodDto(createVisitRecordSchema) {}
