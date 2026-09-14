import { z } from 'zod';

export const filterControlKindSchema = z.enum([
  'text',
  'select',
  'multiSelect',
  'entitySelect',
  'entityMultiSelect',
  'date',
  'dateRange',
  'numberEqual',
  'numberRange',
  'switch',
]);

export const filterFieldDataTypeSchema = z.enum([
  'enum',
  'string',
  'date',
  'foreignKey',
  'decimal',
  'int',
  'boolean',
]);

export const filterOptionSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
});

export const filterFieldItemSchema = z.object({
  fieldKey: z.string().min(1).max(100),
  control: filterControlKindSchema,
  width: z.string().max(32).optional(),
  label: z.string().max(100).optional().nullable(),
});

export const keywordConfigSchema = z.object({
  enabled: z.boolean(),
  fieldKeys: z.array(z.string().min(1).max(100)),
  placeholder: z.string().max(100).optional().nullable(),
});

export const filterSchemeConfigSchema = z.object({
  fields: z.array(filterFieldItemSchema),
  keyword: keywordConfigSchema,
});

export const filterRegistryFieldMetaSchema = z.object({
  fieldKey: z.string().min(1).max(100),
  label: z.string().min(1).max(100),
  dataType: filterFieldDataTypeSchema,
  allowedControls: z.array(filterControlKindSchema).min(1),
  searchable: z.boolean().optional(),
  entity: z.string().max(50).optional().nullable(),
  isScopeField: z.boolean().optional(),
  options: z.array(filterOptionSchema).optional(),
});

export const filterRegistryMetaSchema = z.object({
  pageKey: z.string().min(1).max(80),
  pageName: z.string().max(100).optional().nullable(),
  defaults: filterSchemeConfigSchema,
  fields: z.array(filterRegistryFieldMetaSchema),
});

export const filterSchemeSummarySchema = z.object({
  pageKey: z.string().min(1).max(80),
  pageName: z.string().max(100).optional().nullable(),
  fieldCount: z.number().int().nonnegative(),
  activeFieldCount: z.number().int().nonnegative(),
  version: z.number().int().min(1),
  updatedAt: z.string().optional().nullable(),
});

export const filterSchemeListResponseSchema = z.object({
  items: z.array(filterSchemeSummarySchema),
  total: z.number().int().nonnegative(),
});

export const filterSchemeDetailResponseSchema = z.object({
  registry: filterRegistryMetaSchema,
  config: filterSchemeConfigSchema,
  version: z.number().int().min(1),
});

export const filterSchemeVersionMapResponseSchema = z.record(z.string(), z.number().int().min(1));

export const updateFilterSchemeSchema = filterSchemeConfigSchema.extend({
  version: z.number().int().min(1).optional(),
});

export type FilterControlKind = z.infer<typeof filterControlKindSchema>;
export type FilterFieldDataType = z.infer<typeof filterFieldDataTypeSchema>;
export type FilterOption = z.infer<typeof filterOptionSchema>;
export type FilterFieldItem = z.infer<typeof filterFieldItemSchema>;
export type KeywordConfig = z.infer<typeof keywordConfigSchema>;
export type FilterSchemeConfig = z.infer<typeof filterSchemeConfigSchema>;
export type FilterRegistryFieldMeta = z.infer<typeof filterRegistryFieldMetaSchema>;
export type FilterRegistryMeta = z.infer<typeof filterRegistryMetaSchema>;
export type FilterSchemeSummary = z.infer<typeof filterSchemeSummarySchema>;
export type FilterSchemeListResponse = z.infer<typeof filterSchemeListResponseSchema>;
export type FilterSchemeDetailResponse = z.infer<typeof filterSchemeDetailResponseSchema>;
export type FilterSchemeVersionMapResponse = z.infer<typeof filterSchemeVersionMapResponseSchema>;
export type UpdateFilterSchemeInput = z.infer<typeof updateFilterSchemeSchema>;
