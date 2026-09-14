import { loginSchema } from '@ky-azeroth/shared/schemas/auth';
import { createZodDto } from 'nestjs-zod';

export class LoginDto extends createZodDto(loginSchema) {}
