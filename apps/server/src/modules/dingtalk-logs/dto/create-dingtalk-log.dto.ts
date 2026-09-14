import { createDingtalkLogSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class CreateDingtalkLogDto extends createZodDto(createDingtalkLogSchema) {}
