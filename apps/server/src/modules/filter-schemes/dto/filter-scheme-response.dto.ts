import {
  filterSchemeDetailResponseSchema,
  filterSchemeListResponseSchema,
  filterSchemeVersionMapResponseSchema,
} from '@ky-azeroth/shared/schemas/filter-scheme';
import { createZodDto } from 'nestjs-zod';

export class FilterSchemeDetailResponseDto extends createZodDto(filterSchemeDetailResponseSchema) {}

export class FilterSchemeListResponseDto extends createZodDto(filterSchemeListResponseSchema) {}

export class FilterSchemeVersionMapResponseDto extends createZodDto(
  filterSchemeVersionMapResponseSchema
) {}
