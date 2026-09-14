import { updateCrmWorkDailySchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class UpdateCrmWorkDailyDto extends createZodDto(updateCrmWorkDailySchema) {}
