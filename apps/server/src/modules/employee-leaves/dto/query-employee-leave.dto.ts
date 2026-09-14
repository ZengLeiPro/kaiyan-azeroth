import { queryEmployeeLeaveSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class QueryEmployeeLeaveDto extends createZodDto(queryEmployeeLeaveSchema) {}
