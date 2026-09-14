import { mutationVersionQuerySchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class MutationVersionQueryDto extends createZodDto(mutationVersionQuerySchema) {}
