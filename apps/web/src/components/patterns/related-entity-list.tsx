import { ExternalLink, Inbox, Loader2, Plus, RefreshCw } from 'lucide-react';
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { type DrawerEntityType, useDrawerStackOptional } from '@/components/patterns/drawer-stack';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ServerPaginationResponse } from '@/hooks/use-server-pagination';
import { api, getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * 浅层 memoize 一个对象 / 数组，使其在内容相同时引用稳定。
 * 用 JSON.stringify 做内容比较；适用于纯字符串/数字/嵌套对象的查询参数。
 *
 * 原因：父组件 inline 传入 `queryParams={{ customerId, sortBy: 'createdAt', ...}}`
 * 时每次 re-render 都会生成新对象，会让 useEffect deps 变化触发重 fetch。
 */
function useDeepCompareMemoize<T>(value: T): T {
  const ref = useRef<T>(value);
  try {
    if (JSON.stringify(ref.current) !== JSON.stringify(value)) {
      ref.current = value;
    }
  } catch {
    ref.current = value;
  }
  return ref.current;
}

export interface RelatedEntityColumn<T> {
  /** 列 key（仅用于 React key） */
  key: string;
  /** 表头文案 */
  header: string;
  /** 列宽 (Tailwind class，如 'w-32') */
  className?: string;
  /** 自定义渲染；不传则取 row[key] 作为字符串 */
  render?: (row: T) => ReactNode;
}

export interface RelatedEntityListProps<T extends { id: string }> {
  /** API endpoint 例如 `/contacts` */
  endpoint: string;
  /** 顶层查询参数（如 `{ customerId, sortBy, sortOrder }`） */
  queryParams: Record<string, string | number | undefined>;
  /** 列定义 */
  columns: RelatedEntityColumn<T>[];
  /** 空态文案 */
  emptyHint: string;
  /**
   * 行点击跳转目标。传入则点击行 navigate(`${targetRoute}?highlight=${row.id}`)
   * 触发目标页 useHighlightNavigation 自动打开详情。
   */
  targetRoute?: string;
  /** 默认分页大小，drawer 内嵌不分页，默认拉首批 20 条 */
  pageSize?: number;
  /**
   * 关联实体类型。在 DrawerStack context 内（即处于另一个抽屉视图里）传入此 prop 时，
   * 行点击会优先调 stack.push 叠加打开详情；否则走 targetRoute navigate fallback。
   *
   * 用例：客户抽屉里的「合同订单」Tab，传 entityType='sale-order'，点击行直接叠层打开订单详情。
   */
  entityType?: DrawerEntityType;
  /**
   * 提供给叠层打开时的标题（面包屑/返回按钮文案）。可选，未提供时 Host 走默认实体名。
   */
  getRowTitle?: (row: T) => string;
  /**
   * 透传给叠层详情 entry 的来源上下文。典型场景：客户详情内下钻时保留来源客户名。
   */
  drawerEntryContext?: Record<string, unknown>;
  /**
   * 提供后在列表右上角渲染"新增"按钮，点击触发该回调。典型用法：在客户/订单详情 Tab 内
   * 调 `drawerStack.push({ type, mode:'create', presets:{...} })` 叠层打开创建表单。
   */
  onCreate?: () => void;
  /** 新增按钮文案，默认 "新增" */
  createLabel?: string;
  /**
   * 工具栏右侧追加的自定义按钮组（与默认的 onCreate 并列展示）。
   * 典型场景：订单详情「关联回款」区块同时提供「新增回款」和「新增退款」两个入口。
   */
  extraToolbarActions?: ReactNode;
  /**
   * 顶部 summary 槽（onCreate 上方渲染）。典型场景：
   * 订单详情「关联回款」上方展示「毛回款 / 退款 / 净回款 / 应收 / 未收」5 数字 statbar。
   */
  summary?: ReactNode;
}

/**
 * Drawer/Tab 内嵌的关联实体列表。
 *
 * 用于客户/项目详情 Drawer 的 Tabs 内展示「该客户的联系人/商机/合同/...」
 * 「该项目的工单/工时」等关联数据。后端列表接口统一支持顶层 `?customerId=`
 * 或 `?projectId=` 过滤（通过各 service 的 `buildLegacyFilters`）。
 *
 * 设计：
 * - 三态：loading / error / data（含空态）
 * - 不内置分页 UI，超过 pageSize 时尾部渲染"查看全部 N 条 →"链接，跳到模块列表
 * - 行点击：navigate 到 `targetRoute?highlight=<id>`（依赖 useHighlightNavigation）
 * - 简洁化：不复用 useServerPagination/CrudTable（drawer 内嵌只需轻量列表）
 */
export function RelatedEntityList<T extends { id: string }>({
  endpoint,
  queryParams,
  columns,
  emptyHint,
  targetRoute,
  pageSize = 20,
  entityType,
  getRowTitle,
  drawerEntryContext,
  onCreate,
  createLabel = '新增',
  extraToolbarActions,
  summary,
}: RelatedEntityListProps<T>) {
  const navigate = useNavigate();
  const drawerStack = useDrawerStackOptional();
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stableQueryParams = useDeepCompareMemoize(queryParams);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string | number> = { page: 1, pageSize };
      Object.entries(stableQueryParams).forEach(([k, v]) => {
        if (v !== undefined && v !== '') {
          params[k] = v;
        }
      });
      const res = await api.get<ServerPaginationResponse<T>>(endpoint, { params });
      setItems(res.data.items ?? []);
      setTotal(res.data.total ?? 0);
    } catch (err) {
      setError(getErrorMessage(err, '加载失败'));
    } finally {
      setLoading(false);
    }
  }, [endpoint, stableQueryParams, pageSize]);

  useEffect(() => {
    load();
  }, [load]);

  // 接入 DrawerStack：当用户从本列表 push 入二级抽屉编辑了某记录后回到一级（栈空），
  // 触发本列表 refetch 避免数据陈旧。栈内 view 内的 RelatedEntityList 在 view 卸载时
  // 自动反注册，不会受影响。
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!drawerStack || !entityType) return;
    return drawerStack.registerOnPopBack('', () => loadRef.current());
  }, [drawerStack, entityType]);

  // 接入实体变更事件总线：二级抽屉内同层切换保存（不触发 pop）后，需要让本列表也 refetch。
  // 仅监听自己 entityType 的事件，避免不相关的实体保存触发刷新。
  useEffect(() => {
    if (!drawerStack || !entityType) return;
    return drawerStack.registerEntityChanged((changedType) => {
      if (changedType === entityType) loadRef.current();
    });
  }, [drawerStack, entityType]);

  const createButton = onCreate ? (
    <Button type="button" size="sm" variant="outline" className="h-7 gap-1" onClick={onCreate}>
      <Plus className="h-3.5 w-3.5" />
      {createLabel}
    </Button>
  ) : null;

  const renderToolbar = () => {
    if (!createButton && !extraToolbarActions) return null;
    return (
      <div className="flex items-center justify-start gap-2">
        {createButton}
        {extraToolbarActions}
      </div>
    );
  };

  const renderSummary = () => (summary ? <div>{summary}</div> : null);

  // 加载态
  if (loading) {
    return (
      <div className="space-y-2">
        {renderSummary()}
        {renderToolbar()}
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">加载中...</span>
        </div>
      </div>
    );
  }

  // 错误态
  if (error) {
    return (
      <div className="space-y-2">
        {renderSummary()}
        {renderToolbar()}
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-destructive/40 bg-destructive/5 p-6">
          <p className="text-sm text-destructive">{error}</p>
          <Button type="button" variant="outline" size="sm" onClick={load}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            重试
          </Button>
        </div>
      </div>
    );
  }

  // 空态
  if (items.length === 0) {
    return (
      <div className="space-y-2">
        {renderSummary()}
        {renderToolbar()}
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-6 text-sm text-muted-foreground">
          <Inbox className="h-6 w-6 opacity-60" />
          <span>{emptyHint}</span>
        </div>
      </div>
    );
  }

  const handleRowClick = (row: T) => {
    // 1) 在叠层栈内 + 提供了 entityType → 叠加一层抽屉，不路由跳走
    if (drawerStack && entityType) {
      drawerStack.push({
        type: entityType,
        id: row.id,
        title: getRowTitle?.(row),
        context: drawerEntryContext,
      });
      return;
    }
    // 2) 否则保持原行为：跳到目标列表页并触发 highlight 自动开详情
    if (!targetRoute) return;
    navigate(`${targetRoute}?highlight=${encodeURIComponent(row.id)}`);
  };

  const handleViewAll = () => {
    if (!targetRoute) return;
    // 列表页未来可能支持 ?customerId 透传以预筛选；先做单纯跳转
    navigate(targetRoute);
  };

  const hasMore = total > items.length;
  // 叠层模式下也算 clickable（不需要 targetRoute）
  const rowClickable = !!targetRoute || (!!drawerStack && !!entityType);

  return (
    <div className="space-y-2">
      {renderSummary()}
      {renderToolbar()}
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col.key} className={cn('whitespace-nowrap', col.className)}>
                {col.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((row) => (
            <TableRow
              key={row.id}
              className={cn(rowClickable && 'cursor-pointer')}
              onClick={rowClickable ? () => handleRowClick(row) : undefined}
            >
              {columns.map((col) => (
                <TableCell key={col.key} className={cn('align-top', col.className)}>
                  {col.render
                    ? col.render(row)
                    : (((row as unknown as Record<string, unknown>)[col.key] ?? '-') as ReactNode)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          共 {total} 条{hasMore ? `，仅显示前 ${items.length} 条` : ''}
        </span>
        {hasMore && targetRoute && (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0"
            onClick={handleViewAll}
          >
            查看全部
            <ExternalLink className="ml-1 h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
}
