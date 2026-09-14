import { Settings } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { CrudFilterBar } from '@/components/patterns/crud-filter-bar';
import { CrudTable } from '@/components/patterns/crud-table';
import { FilterBarSkeleton } from '@/components/patterns/filter-bar-skeleton';
import { GenericMobileCard } from '@/components/patterns/generic-mobile-card';
import { StandardToolbar } from '@/components/patterns/standard-toolbar';
import { StandardLayout } from '@/components/templates/standard-layout';
import { Button } from '@/components/ui/button';
import { type DataTableColumn } from '@/components/ui/data-table';
import { Switch } from '@/components/ui/switch';
import { useFilterScheme } from '@/hooks/use-filter-scheme';
import { useManualFilter } from '@/hooks/use-manual-filter';
import { api, getErrorMessage } from '@/lib/api';
import { COL_STATUS } from '@/lib/column-widths';

/** 模块审批状态项 */
interface ModuleStatusItem {
  eventType: string;
  label: string;
  category: string;
  categoryLabel: string;
  enabled: boolean;
  hasFlows: boolean;
  activeFlow: { id: string; name: string; version: number } | null;
}

const CATEGORY_FILTER_KEY = 'filters[category][]';
const ENABLED_FILTER_KEY = 'filters[enabled]';

export function ApprovalSettingsPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<ModuleStatusItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [operating, setOperating] = useState<string | null>(null);

  const scheme = useFilterScheme('approval_settings');
  const filter = useManualFilter(scheme.initialFilters, undefined, scheme.version);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.get<ModuleStatusItem[]>('/approval-flows/module-status');
      setData(res.data);
    } catch (error) {
      setLoadError(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 客户端筛选：仅替换筛选栏展示来源，保留原有的精确匹配语义。
  const filteredData = useMemo(() => {
    const keyword = filter.activeFilters.keyword;
    const categories = filter.activeFilters[CATEGORY_FILTER_KEY];
    const enabled = filter.activeFilters[ENABLED_FILTER_KEY];
    const selectedCategories = Array.isArray(categories) ? categories : [];

    return data.filter((item) => {
      if (typeof keyword === 'string' && keyword && !item.label.includes(keyword)) return false;
      if (selectedCategories.length > 0 && !selectedCategories.includes(item.category))
        return false;
      if (enabled === 'true' && !item.enabled) return false;
      if (enabled === 'false' && item.enabled) return false;
      return true;
    });
  }, [data, filter.activeFilters]);

  /** 切换开关 */
  const handleToggle = useCallback(
    async (item: ModuleStatusItem) => {
      if (item.enabled) {
        setOperating(item.eventType);
        try {
          await api.post(`/approval-flows/disable/${item.eventType}`);
          toast.success(`${item.label} 审批已停用`);
          fetchData();
        } catch (err) {
          toast.error(getErrorMessage(err));
        } finally {
          setOperating(null);
        }
      } else if (item.hasFlows) {
        setOperating(item.eventType);
        try {
          const res = await api.post<{ enabled: boolean }>(
            `/approval-flows/enable/${item.eventType}`
          );
          if (res.data.enabled) {
            toast.success(`${item.label} 审批已启用`);
            fetchData();
          }
        } catch (err) {
          toast.error(getErrorMessage(err));
        } finally {
          setOperating(null);
        }
      } else {
        navigate(`/approval/flows/new?eventType=${item.eventType}&from=settings`);
      }
    },
    [navigate, fetchData]
  );

  const columns: DataTableColumn<ModuleStatusItem>[] = [
    {
      key: 'label',
      header: '业务模块',
      width: 150, // 模块名称较长，无匹配常量
    },
    {
      key: 'categoryLabel',
      header: '所属分类',
      width: 120, // 分类文字中等长度，无匹配常量
      render: (item) => <span className="text-muted-foreground">{item.categoryLabel}</span>,
    },
    {
      key: 'enabled',
      header: '审批开关',
      width: COL_STATUS,
      render: (item) => {
        const isOperating = operating === item.eventType;
        return (
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <Switch
              checked={item.enabled}
              disabled={isOperating}
              onCheckedChange={() => handleToggle(item)}
            />
            <span className="text-xs text-muted-foreground">
              {item.enabled ? '已启用' : '未启用'}
            </span>
          </div>
        );
      },
    },
    {
      key: 'activeFlow',
      header: '当前流程',
      render: (item) =>
        item.activeFlow ? (
          <span>{item.activeFlow.name}</span>
        ) : (
          <span className="text-muted-foreground">{item.hasFlows ? '已停用' : '未配置'}</span>
        ),
    },
    {
      key: 'actions',
      header: '操作',
      width: COL_STATUS, // 含文字按钮，比 COL_ACTION 更宽
      render: (item) =>
        item.activeFlow ? (
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/approval/flows/${item.activeFlow!.id}?from=settings`);
            }}
          >
            查看流程
          </Button>
        ) : !item.hasFlows ? (
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/approval/flows/new?eventType=${item.eventType}&from=settings`);
            }}
          >
            去配置
          </Button>
        ) : null,
    },
  ];

  const renderMobileCard = (item: ModuleStatusItem) => (
    <GenericMobileCard
      title={item.label}
      status={
        <Switch
          checked={item.enabled}
          disabled={operating === item.eventType}
          onCheckedChange={() => handleToggle(item)}
        />
      }
      fields={[
        { label: '分类', value: item.categoryLabel },
        { label: '流程', value: item.activeFlow?.name || (item.hasFlows ? '已停用' : '未配置') },
      ]}
      onClick={() => {
        if (item.activeFlow) {
          navigate(`/approval/flows/${item.activeFlow.id}?from=settings`);
        }
      }}
      testId={`module-${item.eventType}`}
    />
  );

  return (
    <StandardLayout
      toolbar={
        <StandardToolbar
          onSearch={filter.search}
          onReset={filter.reset}
          filters={
            scheme.isLoading ? (
              <FilterBarSkeleton count={3} />
            ) : (
              <CrudFilterBar
                fields={scheme.fields}
                values={filter.tempFilters}
                onChange={filter.setFilter}
                personalFilter={
                  scheme.registry && scheme.config && scheme.defaultConfig
                    ? {
                        pageKey: scheme.registry.pageKey,
                        registry: scheme.registry,
                        config: scheme.config,
                        defaultConfig: scheme.defaultConfig,
                        onApply: filter.replaceFilters,
                      }
                    : undefined
                }
              />
            )
          }
        />
      }
    >
      <CrudTable
        data={filteredData}
        columns={columns}
        loading={loading}
        error={loadError}
        onRetry={() => void fetchData()}
        stale={Boolean(loadError && data.length > 0)}
        renderMobileCard={renderMobileCard}
        hidePagination
        emptyState={{
          title: '暂无可配置模块',
          description: '请在代码注册表中添加业务模块',
          icon: <Settings className="h-12 w-12 text-muted-foreground/50" />,
        }}
      />
    </StandardLayout>
  );
}

export default ApprovalSettingsPage;
