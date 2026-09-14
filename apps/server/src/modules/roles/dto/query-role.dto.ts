import { queryRoleSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryRoleDto extends createZodDto(queryRoleSchema) {}
