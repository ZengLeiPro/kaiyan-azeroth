import { orgHeadcountTrendQuerySchema } from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class OrgHeadcountTrendQueryDto extends createZodDto(orgHeadcountTrendQuerySchema) {}
