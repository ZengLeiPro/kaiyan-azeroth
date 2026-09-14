import { updateRoleSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class UpdateRoleDto extends createZodDto(updateRoleSchema) {}
