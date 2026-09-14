import { userSelectionQuerySchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class UserSelectionQueryDto extends createZodDto(userSelectionQuerySchema) {}
