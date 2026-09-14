import { updateDingtalkLogSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class UpdateDingtalkLogDto extends createZodDto(updateDingtalkLogSchema) {}
