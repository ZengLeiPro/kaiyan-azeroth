import { dingtalkLoginSchema } from '@ky-azeroth/shared/schemas/auth';
import { createZodDto } from 'nestjs-zod';

export class DingtalkLoginDto extends createZodDto(dingtalkLoginSchema) {}
