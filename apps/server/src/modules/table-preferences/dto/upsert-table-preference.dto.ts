import { upsertTablePreferenceSchema } from '@ky-azeroth/shared/schemas/table-preference';
import { createZodDto } from 'nestjs-zod';

export class UpsertTablePreferenceDto extends createZodDto(upsertTablePreferenceSchema) {}
