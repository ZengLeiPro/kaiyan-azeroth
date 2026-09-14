import { z } from 'zod';

import { filterSchemeConfigSchema } from './filter-scheme';

export const filterValuesSchema = z.record(z.string(), z.union([z.string(), z.array(z.string())]));

export const personalFilterPreferenceResponseSchema = z.object({
  pageKey: z.string().min(1).max(80),
  config: filterSchemeConfigSchema,
  version: z.number().int().min(1),
});

export const updatePersonalFilterPreferenceSchema = filterSchemeConfigSchema.extend({
  version: z.number().int().min(1).optional(),
});

export const personalFilterPresetSchema = z.object({
  id: z.string().uuid(),
  pageKey: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  filters: filterValuesSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int().min(1),
});

export const personalFilterPresetListResponseSchema = z.object({
  items: z.array(personalFilterPresetSchema),
  total: z.number().int().nonnegative(),
});

export const createPersonalFilterPresetSchema = z.object({
  name: z.string().trim().min(1).max(80),
  filters: filterValuesSchema,
});

export const updatePersonalFilterPresetSchema = createPersonalFilterPresetSchema.partial().extend({
  version: z.number().int().min(1),
});

export type FilterValues = z.infer<typeof filterValuesSchema>;
export type PersonalFilterPreferenceResponse = z.infer<
  typeof personalFilterPreferenceResponseSchema
>;
export type UpdatePersonalFilterPreferenceInput = z.infer<
  typeof updatePersonalFilterPreferenceSchema
>;
export type PersonalFilterPreset = z.infer<typeof personalFilterPresetSchema>;
export type PersonalFilterPresetListResponse = z.infer<
  typeof personalFilterPresetListResponseSchema
>;
export type CreatePersonalFilterPresetInput = z.infer<typeof createPersonalFilterPresetSchema>;
export type UpdatePersonalFilterPresetInput = z.infer<typeof updatePersonalFilterPresetSchema>;
