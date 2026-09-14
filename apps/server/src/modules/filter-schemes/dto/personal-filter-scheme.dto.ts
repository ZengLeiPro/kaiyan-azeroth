import {
  createPersonalFilterPresetSchema,
  personalFilterPreferenceResponseSchema,
  personalFilterPresetListResponseSchema,
  personalFilterPresetSchema,
  updatePersonalFilterPreferenceSchema,
  updatePersonalFilterPresetSchema,
} from '@ky-azeroth/shared/schemas/personal-filter-scheme';
import { createZodDto } from 'nestjs-zod';

export class PersonalFilterPreferenceResponseDto extends createZodDto(
  personalFilterPreferenceResponseSchema
) {}

export class UpdatePersonalFilterPreferenceDto extends createZodDto(
  updatePersonalFilterPreferenceSchema
) {}

export class PersonalFilterPresetDto extends createZodDto(personalFilterPresetSchema) {}

export class PersonalFilterPresetListResponseDto extends createZodDto(
  personalFilterPresetListResponseSchema
) {}

export class CreatePersonalFilterPresetDto extends createZodDto(createPersonalFilterPresetSchema) {}

export class UpdatePersonalFilterPresetDto extends createZodDto(updatePersonalFilterPresetSchema) {}
