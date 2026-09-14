import { bindEmployeeDingtalkSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class BindEmployeeDingtalkDto extends createZodDto(bindEmployeeDingtalkSchema) {}
