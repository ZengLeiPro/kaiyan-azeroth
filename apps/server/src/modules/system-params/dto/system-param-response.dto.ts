import {
  systemParamGroupedListResponseSchema,
  systemParamResponseSchema,
} from '@ky-azeroth/shared/schemas';
import { createZodDto } from 'nestjs-zod';

export class SystemParamResponseDto extends createZodDto(systemParamResponseSchema) {}

export class SystemParamGroupedListResponseDto extends createZodDto(
  systemParamGroupedListResponseSchema
) {}
