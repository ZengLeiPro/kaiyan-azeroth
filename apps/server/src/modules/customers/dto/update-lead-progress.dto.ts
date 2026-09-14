import { updateLeadProgressSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class UpdateLeadProgressDto extends createZodDto(updateLeadProgressSchema) {}
