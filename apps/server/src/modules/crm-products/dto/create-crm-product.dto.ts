import { createCrmProductSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class CreateCrmProductDto extends createZodDto(createCrmProductSchema) {}
