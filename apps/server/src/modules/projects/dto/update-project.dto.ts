import { updateProjectSchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class UpdateProjectDto extends createZodDto(updateProjectSchema) {}
