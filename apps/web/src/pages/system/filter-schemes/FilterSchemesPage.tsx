import type {
  FilterControlKind,
  FilterRegistryFieldMeta,
  FilterSchemeDetailResponse,
  FilterSchemeListResponse,
  FilterSchemeSummary,
} from '@ky-azeroth/shared/schemas/filter-scheme';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, RotateCcw, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { DeleteConfirm } from '@/components/patterns/delete-confirm';
import { StandardLayout } from '@/components/templates/standard-layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { filterSchemeQueryKey } from '@/hooks/use-filter-scheme';
import { api, getErrorMessage } from '@/lib/api';

import { AddableFieldsPanel } from './components/AddableFieldsPanel';
import { EnabledFieldsEditor } from './components/EnabledFieldsEditor';
import { KeywordConfigPanel } from './components/KeywordConfigPanel';
import { PageKeyList } from './components/PageKeyList';
import { PreviewPanel } from './components/PreviewPanel';
import {
  detailToDraft,
  draftToConfig,
  type FilterSchemeDraft,
  type FilterSchemeSummaryWithDirty,
} from './types';

const LIST_QUERY_KEY = ['filter-schemes', 'list'] as const;

export function FilterSchemesPage() {
  const queryClient = useQueryClient();
  const [selectedPageKey, setSelectedPageKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<FilterSchemeDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmEmptyOpen, setConfirmEmptyOpen] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);

  const listQuery = useQuery<FilterSchemeListResponse>({
    queryKey: LIST_QUERY_KEY,
    queryFn: async () => {
      const res = await api.get<FilterSchemeListResponse>('/filter-schemes');
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  // 当 list 第一次加载成功且未选中任何 pageKey 时，默认选第一条
  useEffect(() => {
    if (!selectedPageKey && listQuery.data && listQuery.data.items.length > 0) {
      setSelectedPageKey(listQuery.data.items[0]!.pageKey);
    }
  }, [listQuery.data, selectedPageKey]);

  const detailQuery = useQuery<FilterSchemeDetailResponse>({
    queryKey: selectedPageKey ? filterSchemeQueryKey(selectedPageKey) : ['filter-scheme', 'none'],
    queryFn: async () => {
      const res = await api.get<FilterSchemeDetailResponse>(`/filter-schemes/${selectedPageKey}`);
      return res.data;
    },
    enabled: !!selectedPageKey,
    staleTime: 5 * 60 * 1000,
  });

  // detail 成功后初始化 draft
  useEffect(() => {
    if (detailQuery.data) {
      setDraft(detailToDraft(detailQuery.data));
      setDirty(false);
    }
  }, [detailQuery.data]);

  // 离开未保存的改动 —— 使用 beforeunload 阻止关闭 tab/刷新
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const registryFieldMap = useMemo(() => {
    if (!detailQuery.data) return new Map<string, FilterRegistryFieldMeta>();
    return new Map(detailQuery.data.registry.fields.map((f) => [f.fieldKey, f]));
  }, [detailQuery.data]);

  const searchableFields = useMemo(() => {
    if (!detailQuery.data) return [];
    return detailQuery.data.registry.fields.filter(
      (f) => f.searchable === true && f.dataType === 'string'
    );
  }, [detailQuery.data]);

  // 校验 —— 用于禁用保存按钮
  const validationError = useMemo(
    () => validateDraft(draft, registryFieldMap),
    [draft, registryFieldMap]
  );

  const listItems: FilterSchemeSummaryWithDirty[] = useMemo(() => {
    if (!listQuery.data) return [];
    return listQuery.data.items.map((item: FilterSchemeSummary) => ({
      ...item,
      dirty: item.pageKey === selectedPageKey ? dirty : false,
    }));
  }, [listQuery.data, selectedPageKey, dirty]);

  const updateDraft = (next: FilterSchemeDraft) => {
    setDraft(next);
    setDirty(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPageKey || !draft || !detailQuery.data) return;
      const body = {
        ...draftToConfig(draft),
        version: detailQuery.data.version,
      };
      const res = await api.put<FilterSchemeDetailResponse>(
        `/filter-schemes/${selectedPageKey}`,
        body
      );
      return res.data;
    },
    onSuccess: async (data) => {
      if (!data || !selectedPageKey) return;
      toast.success('已保存，所有用户打开或切回页面时生效');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: filterSchemeQueryKey(selectedPageKey) }),
        queryClient.invalidateQueries({ queryKey: LIST_QUERY_KEY }),
      ]);
      setDraft(detailToDraft(data));
      setDirty(false);
    },
    onError: (err) => {
      const msg = getErrorMessage(err, '保存失败');
      toast.error(msg);
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPageKey) return;
      const res = await api.post<FilterSchemeDetailResponse>(
        `/filter-schemes/${selectedPageKey}/reset`
      );
      return res.data;
    },
    onSuccess: async (data) => {
      if (!data || !selectedPageKey) return;
      toast.success('已恢复默认');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: filterSchemeQueryKey(selectedPageKey) }),
        queryClient.invalidateQueries({ queryKey: LIST_QUERY_KEY }),
      ]);
      setDraft(detailToDraft(data));
      setDirty(false);
    },
    onError: (err) => {
      toast.error(getErrorMessage(err, '恢复默认失败'));
    },
  });

  const handleSelectPageKey = (pageKey: string) => {
    if (dirty) {
      const confirmed = window.confirm('当前页面有未保存的修改，是否放弃？');
      if (!confirmed) return;
    }
    setSelectedPageKey(pageKey);
    setDraft(null);
    setDirty(false);
  };

  const handleTrySave = () => {
    if (!draft || !selectedPageKey) return;
    if (validationError) {
      toast.error(validationError);
      return;
    }
    // 特殊确认：字段全删且 keyword 关闭时需二次确认
    if (
      draft.fields.length === 0 &&
      (!draft.keyword.enabled || draft.keyword.fieldKeys.length === 0)
    ) {
      setConfirmEmptyOpen(true);
      return;
    }
    saveMutation.mutate();
  };

  const handleReorder = (next: FilterSchemeDraft['fields']) => {
    if (!draft) return;
    updateDraft({ ...draft, fields: next });
  };

  const handleControlChange = (fieldKey: string, control: FilterControlKind) => {
    if (!draft) return;
    updateDraft({
      ...draft,
      fields: draft.fields.map((f) => (f.fieldKey === fieldKey ? { ...f, control } : f)),
    });
  };

  const handleRemoveField = (fieldKey: string) => {
    if (!draft) return;
    updateDraft({
      ...draft,
      fields: draft.fields.filter((f) => f.fieldKey !== fieldKey),
      // 如果被移除的字段在 keyword.fieldKeys 里，也要同步清理
      keyword: {
        ...draft.keyword,
        fieldKeys: draft.keyword.fieldKeys.filter((k) => k !== fieldKey),
      },
    });
  };

  const handleAddField = (field: FilterRegistryFieldMeta) => {
    if (!draft) return;
    const defaultControl = field.allowedControls[0];
    if (!defaultControl) return;
    updateDraft({
      ...draft,
      fields: [
        ...draft.fields,
        {
          fieldKey: field.fieldKey,
          control: defaultControl,
          label: null,
        },
      ],
    });
  };

  const enabledFieldKeys = useMemo(
    () => new Set(draft?.fields.map((f) => f.fieldKey) ?? []),
    [draft]
  );

  return (
    <StandardLayout>
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold">筛选方案</h1>
          <p className="text-sm text-muted-foreground">
            为每个业务页面配置展示哪些筛选字段、使用什么控件，以及关键词搜索覆盖的字段。
          </p>
        </div>

        <div className="flex h-[calc(100vh-14rem)] gap-4">
          <PageKeyList
            items={listItems}
            selectedPageKey={selectedPageKey}
            onSelect={handleSelectPageKey}
            onResetAll={undefined}
          />

          <section className="flex min-w-0 flex-1 flex-col gap-4 overflow-auto">
            {detailQuery.isLoading ? (
              <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
                加载中...
              </div>
            ) : detailQuery.isError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
                加载失败：{getErrorMessage(detailQuery.error)}
              </div>
            ) : !draft || !detailQuery.data ? (
              <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
                请从左侧选择要配置的页面
              </div>
            ) : (
              <>
                {/* 顶部操作栏 */}
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="truncate text-base font-medium">
                      {detailQuery.data.registry.pageName ?? detailQuery.data.registry.pageKey}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {detailQuery.data.registry.pageKey} · v{detailQuery.data.version}
                      {dirty ? ' · 未保存' : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setConfirmResetOpen(true)}
                      disabled={resetMutation.isPending}
                    >
                      <RotateCcw className="mr-2 h-4 w-4" />
                      恢复本页默认
                    </Button>
                    <Button
                      onClick={handleTrySave}
                      disabled={!dirty || !!validationError || saveMutation.isPending}
                      className="bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      <Save className="mr-2 h-4 w-4" />
                      {saveMutation.isPending ? '保存中...' : '保存并发布'}
                    </Button>
                  </div>
                </div>

                {validationError ? (
                  <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                    <AlertCircle className="h-4 w-4" />
                    <span>{validationError}</span>
                  </div>
                ) : null}

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">启用的筛选字段（拖动排序）</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <EnabledFieldsEditor
                      fields={draft.fields}
                      registryFieldMap={registryFieldMap}
                      onReorder={handleReorder}
                      onControlChange={handleControlChange}
                      onRemove={handleRemoveField}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">可添加字段</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <AddableFieldsPanel
                      allFields={detailQuery.data.registry.fields}
                      enabledFieldKeys={enabledFieldKeys}
                      onAdd={handleAddField}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">关键词搜索</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <KeywordConfigPanel
                      keyword={draft.keyword}
                      searchableFields={searchableFields}
                      onChange={(keyword) => updateDraft({ ...draft, keyword })}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">实时预览</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <PreviewPanel
                      registry={detailQuery.data.registry}
                      config={draftToConfig(draft)}
                    />
                  </CardContent>
                </Card>
              </>
            )}
          </section>
        </div>

        <DeleteConfirm
          open={confirmEmptyOpen}
          onOpenChange={setConfirmEmptyOpen}
          entityName="0 个筛选字段"
          loading={saveMutation.isPending}
          message="将保留 0 个筛选字段，用户只能通过基础浏览查看列表（无关键词搜索、无条件筛选），确认保存？"
          onConfirm={() => {
            setConfirmEmptyOpen(false);
            saveMutation.mutate();
          }}
        />

        <DeleteConfirm
          open={confirmResetOpen}
          onOpenChange={setConfirmResetOpen}
          entityName="本页筛选方案"
          loading={resetMutation.isPending}
          message="将丢弃当前配置并恢复为代码默认值，确认继续？"
          onConfirm={() => {
            setConfirmResetOpen(false);
            resetMutation.mutate();
          }}
        />
      </div>
    </StandardLayout>
  );
}

function validateDraft(
  draft: FilterSchemeDraft | null,
  registryFieldMap: Map<string, FilterRegistryFieldMeta>
): string | null {
  if (!draft) return null;
  if (draft.keyword.enabled && draft.keyword.fieldKeys.length === 0) {
    return '开启关键词搜索时至少选择一个 searchable 字段';
  }
  for (const fieldKey of draft.keyword.fieldKeys) {
    const meta = registryFieldMap.get(fieldKey);
    if (!meta || meta.searchable !== true || meta.dataType !== 'string') {
      return `字段 ${fieldKey} 不是 searchable 字段，请移除`;
    }
  }
  for (const field of draft.fields) {
    const meta = registryFieldMap.get(field.fieldKey);
    if (!meta) {
      return `字段 ${field.fieldKey} 在 registry 中不存在，请删除后重新选择`;
    }
    if (!meta.allowedControls.includes(field.control)) {
      return `字段 ${meta.label} 不支持控件 ${field.control}`;
    }
  }
  return null;
}
