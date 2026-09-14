import { refreshTokenSchema } from '@ky-azeroth/shared/schemas/auth';
import { createZodDto } from 'nestjs-zod';

export class RefreshTokenDto extends createZodDto(refreshTokenSchema) {}
