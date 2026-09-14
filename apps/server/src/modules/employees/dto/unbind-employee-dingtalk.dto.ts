import { unbindEmployeeDingtalkSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class UnbindEmployeeDingtalkDto extends createZodDto(unbindEmployeeDingtalkSchema) {}
