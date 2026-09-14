import { updateCrmProductSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class UpdateCrmProductDto extends createZodDto(updateCrmProductSchema) {}
