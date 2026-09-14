import { submitLeadStageChangeSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class SubmitLeadStageChangeDto extends createZodDto(submitLeadStageChangeSchema) {}
