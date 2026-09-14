import { queryUserSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryUsersDto extends createZodDto(queryUserSchema) {}
