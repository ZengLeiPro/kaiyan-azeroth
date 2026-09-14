import { setDepartmentManagersSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class SetDepartmentManagersDto extends createZodDto(setDepartmentManagersSchema) {}
