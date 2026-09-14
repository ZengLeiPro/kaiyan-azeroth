import { updateFilterSchemeSchema } from '@ky-azeroth/shared/schemas/filter-scheme';
import { createZodDto } from 'nestjs-zod';

export class UpdateFilterSchemeDto extends createZodDto(updateFilterSchemeSchema) {}
