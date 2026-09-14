import { reauthenticateSchema } from '@ky-azeroth/shared/schemas/auth';
import { createZodDto } from 'nestjs-zod';

export class ReauthenticateDto extends createZodDto(reauthenticateSchema) {}
