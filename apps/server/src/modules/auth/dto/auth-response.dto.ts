import {
  loginResponseSchema,
  meResponseSchema,
  refreshTokenResponseSchema,
} from '@ky-azeroth/shared/schemas/auth';
import { createZodDto } from 'nestjs-zod';

export class LoginResponseDto extends createZodDto(loginResponseSchema) {}

export class RefreshTokenResponseDto extends createZodDto(refreshTokenResponseSchema) {}

export class MeResponseDto extends createZodDto(meResponseSchema) {}
