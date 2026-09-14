import { createCrmWorkDailySchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class CreateCrmWorkDailyDto extends createZodDto(createCrmWorkDailySchema) {}
