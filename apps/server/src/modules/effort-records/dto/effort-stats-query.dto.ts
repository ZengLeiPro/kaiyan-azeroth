import { effortStatsQuerySchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class EffortStatsQueryDto extends createZodDto(effortStatsQuerySchema) {}
