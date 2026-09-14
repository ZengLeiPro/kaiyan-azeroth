import { createRoleSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class CreateRoleDto extends createZodDto(createRoleSchema) {}
