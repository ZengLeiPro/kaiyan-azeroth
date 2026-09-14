import type { FilterRegistryFieldMeta } from '@ky-azeroth/shared/schemas/filter-scheme';

import { Input } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

import type { FilterSchemeDraft } from '../types';

export interface KeywordConfigPanelProps {
  keyword: FilterSchemeDraft['keyword'];
  searchableFields: FilterRegistryFieldMeta[];
  onChange: (next: FilterSchemeDraft['keyword']) => void;
}

export function KeywordConfigPanel({
  keyword,
  searchableFields,
  onChange,
}: KeywordConfigPanelProps) {
  const options = searchableFields.map((f) => ({ value: f.fieldKey, label: f.label }));
  const invalidKeywordFieldKeys = keyword.fieldKeys.filter(
    (k) => !searchableFields.some((f) => f.fieldKey === k)
  );
  const validationError =
    keyword.enabled && keyword.fieldKeys.length === 0
      ? '开启关键词搜索时至少选择一个搜索字段'
      : invalidKeywordFieldKeys.length > 0
        ? `字段 ${invalidKeywordFieldKeys.join(', ')} 非 searchable，请移除`
        : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Switch
          checked={keyword.enabled}
          onCheckedChange={(enabled) => onChange({ ...keyword, enabled })}
          aria-label="启用关键词搜索"
        />
        <span className="text-sm">启用关键词搜索</span>
      </div>

      {keyword.enabled ? (
        <>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">关键词搜索字段</div>
            <MultiSelect
              value={keyword.fieldKeys}
              onChange={(fieldKeys) => onChange({ ...keyword, fieldKeys })}
              options={options}
              placeholder={options.length > 0 ? '选择 searchable 字段' : '无 searchable 字段可选'}
              searchable
              disabled={options.length === 0}
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">placeholder（可选）</div>
            <Input
              value={keyword.placeholder}
              onChange={(e) => onChange({ ...keyword, placeholder: e.target.value })}
              placeholder="如：客户名称/电话/负责人"
            />
          </div>
        </>
      ) : null}

      {validationError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {validationError}
        </div>
      ) : null}
    </div>
  );
}
