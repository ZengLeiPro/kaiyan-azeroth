import { correctLeadStageSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class CorrectLeadStageDto extends createZodDto(correctLeadStageSchema) {}
