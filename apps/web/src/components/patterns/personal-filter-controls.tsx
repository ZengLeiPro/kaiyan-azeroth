import type {
  FilterRegistryMeta,
  FilterSchemeConfig,
} from '@ky-azeroth/shared/schemas/filter-scheme';
import type {
  PersonalFilterPreset,
  PersonalFilterPresetListResponse,
} from '@ky-azeroth/shared/schemas/personal-filter-scheme';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Settings2, SlidersHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { FilterValue } from '@/hooks/use-manual-filter';
import { api, getErrorMessage } from '@/lib/api';

interface PersonalFilterControlsProps {
  pageKey: string;
  registry: FilterRegistryMeta;
  config: FilterSchemeConfig;
  defaultConfig: FilterSchemeConfig;
  values: Record<string, FilterValue>;
  onApply: (filters: Record<string, FilterValue>) => void;
}

export function PersonalFilterControls({
  pageKey,
  registry,
  config,
  defaultConfig,
  values,
  onApply,
}: PersonalFilterControlsProps) {
  const queryClient = useQueryClient();
  const [configOpen, setConfigOpen] = useState(false);
  const [draft, setDraft] = useState<FilterSchemeConfig>(config);
  const presetQuery = useQuery<PersonalFilterPresetListResponse>({
    queryKey: ['personal-filter-presets', pageKey],
    queryFn: async () => (await api.get(`/filter-schemes/${pageKey}/personal-presets`)).data,
  });
  const presets = presetQuery.data?.items ?? [];

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['personal-filter-preference', pageKey] }),
      queryClient.invalidateQueries({ queryKey: ['personal-filter-presets', pageKey] }),
    ]);
  };
  const saveConfig = useMutation({
    mutationFn: async (next: FilterSchemeConfig) =>
      api.put(`/filter-schemes/${pageKey}/personal-preference`, next),
    onSuccess: async () => {
      await invalidate();
      setConfigOpen(false);
      toast.success('已保存个人筛选配置');
    },
    onError: (error) => toast.error(getErrorMessage(error, '保存筛选配置失败')),
  });
  const resetConfig = useMutation({
    mutationFn: async () => api.delete(`/filter-schemes/${pageKey}/personal-preference`),
    onSuccess: async () => {
      setDraft(defaultConfig);
      setConfigOpen(false);
      await invalidate();
      toast.success('已恢复系统默认筛选项');
    },
    onError: (error) => toast.error(getErrorMessage(error, '恢复默认失败')),
  });
  const createPreset = useMutation({
    mutationFn: async (name: string) =>
      api.post(`/filter-schemes/${pageKey}/personal-presets`, { name, filters: values }),
    onSuccess: async () => {
      await invalidate();
      toast.success('已保存筛选方案');
    },
    onError: (error) => toast.error(getErrorMessage(error, '保存筛选方案失败')),
  });
  const updatePreset = useMutation({
    mutationFn: async (preset: PersonalFilterPreset) =>
      api.put(`/filter-schemes/personal-presets/${preset.id}`, {
        filters: values,
        version: preset.version,
      }),
    onSuccess: async () => {
      await invalidate();
      toast.success('已更新筛选方案');
    },
    onError: (error) => toast.error(getErrorMessage(error, '更新筛选方案失败')),
  });
  const renamePreset = useMutation({
    mutationFn: async ({ preset, name }: { preset: PersonalFilterPreset; name: string }) =>
      api.put(`/filter-schemes/personal-presets/${preset.id}`, { name, version: preset.version }),
    onSuccess: async () => {
      await invalidate();
      toast.success('已重命名筛选方案');
    },
    onError: (error) => toast.error(getErrorMessage(error, '重命名失败')),
  });
  const removePreset = useMutation({
    mutationFn: async (preset: PersonalFilterPreset) =>
      api.delete(`/filter-schemes/personal-presets/${preset.id}/${preset.version}`),
    onSuccess: async () => {
      await invalidate();
      toast.success('已删除筛选方案');
    },
    onError: (error) => toast.error(getErrorMessage(error, '删除失败')),
  });

  const configuredKeys = useMemo(() => new Set(draft.fields.map((item) => item.fieldKey)), [draft]);
  const updateFields = (fieldKey: string, checked: boolean) => {
    const field = registry.fields.find((item) => item.fieldKey === fieldKey);
    const control = field?.allowedControls[0];
    if (!field || !control) return;
    setDraft((current) => ({
      ...current,
      fields: checked
        ? [...current.fields, { fieldKey, control }]
        : current.fields.filter((item) => item.fieldKey !== fieldKey),
    }));
  };
  const move = (index: number, delta: number) => {
    setDraft((previous) => {
      const nextIndex = index + delta;
      if (nextIndex < 0 || nextIndex >= previous.fields.length) return previous;
      const fields = [...previous.fields];
      const currentField = fields[index];
      const targetField = fields[nextIndex];
      if (!currentField || !targetField) return previous;
      fields[index] = targetField;
      fields[nextIndex] = currentField;
      return { ...previous, fields };
    });
  };
  const promptName = (message: string, current = '') =>
    window.prompt(message, current)?.trim() ?? '';

  return (
    <>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setDraft(config);
            setConfigOpen(true);
          }}
        >
          <Settings2 className="mr-1.5 h-4 w-4" />
          自定义筛选
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            const name = promptName('请输入方案名称');
            if (name) createPreset.mutate(name);
          }}
        >
          <SlidersHorizontal className="mr-1.5 h-4 w-4" />
          保存方案
        </Button>
        {presets.map((preset) => (
          <div
            key={preset.id}
            className="flex items-center rounded-md border bg-background text-xs"
          >
            <Button type="button" variant="ghost" size="sm" onClick={() => onApply(preset.filters)}>
              {preset.name}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => updatePreset.mutate(preset)}
            >
              更新
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                const name = promptName('重命名方案', preset.name);
                if (name && name !== preset.name) renamePreset.mutate({ preset, name });
              }}
            >
              改名
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => removePreset.mutate(preset)}
            >
              删除
            </Button>
          </div>
        ))}
      </div>
      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>自定义筛选项</DialogTitle>
          </DialogHeader>
          <div className="max-h-[55vh] space-y-2 overflow-y-auto">
            {registry.fields.map((field) => (
              <label
                key={field.fieldKey}
                className="flex items-center gap-2 rounded border p-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={configuredKeys.has(field.fieldKey)}
                  onChange={(event) => updateFields(field.fieldKey, event.target.checked)}
                />
                <span className="flex-1">{field.label}</span>
              </label>
            ))}
          </div>
          <div className="space-y-1">
            {draft.fields.map((field, index) => (
              <div key={field.fieldKey} className="flex items-center gap-2 text-sm">
                <span className="flex-1">
                  {registry.fields.find((item) => item.fieldKey === field.fieldKey)?.label}
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={() => move(index, -1)}>
                  上移
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => move(index, 1)}>
                  下移
                </Button>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => resetConfig.mutate()}>
              恢复默认
            </Button>
            <Button type="button" onClick={() => saveConfig.mutate(draft)}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
