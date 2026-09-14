import { projectDistributionQuerySchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class ProjectDistributionQueryDto extends createZodDto(projectDistributionQuerySchema) {}
