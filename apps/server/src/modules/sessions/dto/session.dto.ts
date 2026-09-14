import { createSessionSchema, sessionResponseSchema } from '@ky-azeroth/shared/schemas/system';
import { createZodDto } from 'nestjs-zod';

export class SessionResponseDto extends createZodDto(sessionResponseSchema) {}

export class CreateSessionDto extends createZodDto(createSessionSchema) {}
