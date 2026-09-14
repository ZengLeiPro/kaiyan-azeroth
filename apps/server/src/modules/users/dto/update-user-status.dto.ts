import { updateUserStatusSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class UpdateUserStatusDto extends createZodDto(updateUserStatusSchema) {}
