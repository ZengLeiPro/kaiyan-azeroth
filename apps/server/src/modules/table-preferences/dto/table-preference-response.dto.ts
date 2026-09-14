import { tablePreferenceResponseSchema } from '@ky-azeroth/shared/schemas/table-preference';
import { createZodDto } from 'nestjs-zod';

export class TablePreferenceResponseDto extends createZodDto(tablePreferenceResponseSchema) {}
