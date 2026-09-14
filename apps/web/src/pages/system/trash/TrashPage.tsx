import { AlertTriangle, Clock, RotateCcw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { MobileBottomBarSpacer } from '@/components/mobile';
import { ResponsiveDialog } from '@/components/mobile/ResponsiveDialog';
import { GenericMobileCard } from '@/components/patterns/generic-mobile-card';
import { StandardLayout } from '@/components/templates/standard-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/select';
import { useIsMobile } from '@/hooks/use-mobile';
import { api, getErrorMessage } from '@/lib/api';

import {
  customerToTrashItem,
  productToTrashItem,
  toDeletedCustomerProfile,
  toDeletedProductProfile,
  type TrashItem,
} from './types';

const moduleTypeColors: Record<string, string> = {
  产品: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  客户: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
};

const moduleTypeOptions = [
  { value: '产品', label: '产品' },
  { value: '客户', label: '客户' },
];

function formatDeletedTime(dateStr: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours === 0) {
      const diffMins = Math.floor(diffMs / (1000 * 60));
      return diffMins <= 1 ? '刚刚' : `${diffMins}分钟前`;
    }
    return `${diffHours}小时前`;
  } else if (diffDays === 1) {
    return '昨天';
  } else if (diffDays < 7) {
    return `${diffDays}天前`;
  } else {
    return date.toLocaleDateString('zh-CN');
  }
}

export function TrashPage() {
  const isMobile = useIsMobile();
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [permanentDeleteDialogOpen, setPermanentDeleteDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<TrashItem | null>(null);

  // 筛选状态
  const [keyword, setKeyword] = useState('');
  const [moduleType, setModuleType] = useState<string[]>([]);
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [appliedModuleType, setAppliedModuleType] = useState<string[]>([]);

  // 数据状态
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const allItems: TrashItem[] = [];
      const params = appliedKeyword
        ? `?keyword=${encodeURIComponent(appliedKeyword)}&pageSize=100`
        : '?pageSize=100';

      // 根据筛选决定请求哪些模块
      const fetchProducts = appliedModuleType.length === 0 || appliedModuleType.includes('产品');
      const fetchCustomers = appliedModuleType.length === 0 || appliedModuleType.includes('客户');

      const requests: Promise<void>[] = [];

      if (fetchProducts) {
        requests.push(
          api
            .get(`/crm-products/trash${params}`)
            .then((res) => {
              const productItems = (res.data.items || [])
                .map(toDeletedProductProfile)
                .map(productToTrashItem);
              allItems.push(...productItems);
            })
            .catch(() => {
              // 忽略请求错误，允许部分模块失败
            })
        );
      }

      if (fetchCustomers) {
        requests.push(
          api
            .get(`/customers/trash${params}`)
            .then((res) => {
              const customerItems = (res.data.items || [])
                .map(toDeletedCustomerProfile)
                .map(customerToTrashItem);
              allItems.push(...customerItems);
            })
            .catch(() => {
              // 忽略请求错误
            })
        );
      }

      await Promise.all(requests);

      // 按删除时间倒序排列
      allItems.sort((a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime());
      setItems(allItems);
    } finally {
      setLoading(false);
    }
  }, [appliedKeyword, appliedModuleType]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSearch = () => {
    setAppliedKeyword(keyword);
    setAppliedModuleType(moduleType);
  };

  const handleReset = () => {
    setKeyword('');
    setModuleType([]);
    setAppliedKeyword('');
    setAppliedModuleType([]);
  };

  const handleRestoreClick = (item: TrashItem) => {
    setSelectedItem(item);
    setRestoreDialogOpen(true);
  };

  const handlePermanentDeleteClick = (item: TrashItem) => {
    setSelectedItem(item);
    setPermanentDeleteDialogOpen(true);
  };

  const handleRestore = async () => {
    if (!selectedItem) return;

    try {
      if (selectedItem.moduleType === '客户') {
        if (!Number.isInteger(selectedItem.version) || (selectedItem.version ?? 0) < 1) {
          throw new Error('客户版本无效，请刷新回收站后重试');
        }
        await api.post(selectedItem.restoreEndpoint, { version: selectedItem.version });
      } else {
        await api.post(selectedItem.restoreEndpoint);
      }
      toast.success(`${selectedItem.moduleType} "${selectedItem.name}" 已恢复`);
      setRestoreDialogOpen(false);
      setSelectedItem(null);
      fetchData();
    } catch (error) {
      toast.error(getErrorMessage(error, '恢复失败'));
    }
  };

  const handlePermanentDelete = async () => {
    if (!selectedItem) return;

    try {
      if (selectedItem.moduleType === '客户') {
        if (!Number.isInteger(selectedItem.version) || (selectedItem.version ?? 0) < 1) {
          throw new Error('客户版本无效，请刷新回收站后重试');
        }
        await api.delete(selectedItem.permanentDeleteEndpoint, {
          data: { version: selectedItem.version },
        });
      } else {
        await api.delete(selectedItem.permanentDeleteEndpoint);
      }
      toast.success(`${selectedItem.moduleType} "${selectedItem.name}" 已永久删除`);
      setPermanentDeleteDialogOpen(false);
      setSelectedItem(null);
      fetchData();
    } catch (error) {
      toast.error(getErrorMessage(error, '删除失败'));
    }
  };

  const renderMobileCard = (item: TrashItem) => (
    <GenericMobileCard
      key={item.id}
      title={item.name}
      icon={<Trash2 className="h-4 w-4" />}
      status={
        <Badge className={moduleTypeColors[item.moduleType] || 'bg-gray-100 text-gray-800'}>
          {item.moduleType}
        </Badge>
      }
      fields={[
        {
          label: '编码',
          value: item.code,
          valueClassName: 'font-mono text-xs',
        },
        {
          label: '删除时间',
          value: formatDeletedTime(item.deletedAt),
          valueClassName: 'text-xs',
        },
      ]}
      footer={formatDeletedTime(item.deletedAt)}
      testId={`trash-${item.id}`}
    >
      <div className="mt-2 flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            handleRestoreClick(item);
          }}
        >
          <RotateCcw className="mr-1 h-3 w-3" />
          恢复
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            handlePermanentDeleteClick(item);
          }}
        >
          <Trash2 className="mr-1 h-3 w-3" />
          彻底删除
        </Button>
      </div>
    </GenericMobileCard>
  );

  return (
    <MobileBottomBarSpacer hasBottomBar={isMobile}>
      <StandardLayout
        toolbar={
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="whitespace-nowrap text-sm text-muted-foreground">关键词</label>
                <Input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="编码/名称"
                  className="h-9 w-40"
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="whitespace-nowrap text-sm text-muted-foreground">类型</label>
                <MultiSelect
                  value={moduleType}
                  onChange={(vs) => setModuleType(vs)}
                  options={moduleTypeOptions}
                  placeholder="全部"
                  className="h-9 w-32"
                  contentClassName="min-w-[240px] max-w-[calc(100vw-2rem)]"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleSearch}>
                搜索
              </Button>
              <Button size="sm" variant="outline" onClick={handleReset}>
                重置筛选
              </Button>
            </div>
          </div>
        }
      >
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
            <div className="text-sm text-amber-800 dark:text-amber-200">
              <p className="font-medium">回收站说明</p>
              <p className="mt-1">
                删除的数据会暂存在回收站中，您可以随时恢复。永久删除后将无法恢复，请谨慎操作。
              </p>
            </div>
          </div>
        </div>

        {isMobile ? (
          <div className="space-y-3">
            {loading ? (
              <div className="py-8 text-center text-muted-foreground">加载中...</div>
            ) : items.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">回收站为空</div>
            ) : (
              items.map((item) => renderMobileCard(item))
            )}
          </div>
        ) : (
          <div className="rounded-md border">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-3 text-left text-sm font-medium text-muted-foreground">编码</th>
                  <th className="p-3 text-left text-sm font-medium text-muted-foreground">名称</th>
                  <th className="p-3 text-left text-sm font-medium text-muted-foreground">类型</th>
                  <th className="p-3 text-left text-sm font-medium text-muted-foreground">
                    删除时间
                  </th>
                  <th className="p-3 text-right text-sm font-medium text-muted-foreground">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-muted-foreground">
                      加载中...
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-muted-foreground">
                      回收站为空
                    </td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr key={item.id} className="border-b hover:bg-muted/30">
                      <td className="p-3">
                        <span className="font-mono text-sm">{item.code}</span>
                      </td>
                      <td className="p-3">
                        <span className="font-medium">{item.name}</span>
                      </td>
                      <td className="p-3">
                        <Badge
                          className={
                            moduleTypeColors[item.moduleType] || 'bg-gray-100 text-gray-800'
                          }
                        >
                          {item.moduleType}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Clock className="h-4 w-4" />
                          <span>{formatDeletedTime(item.deletedAt)}</span>
                        </div>
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleRestoreClick(item)}
                          >
                            <RotateCcw className="mr-1 h-3 w-3" />
                            恢复
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handlePermanentDeleteClick(item)}
                          >
                            <Trash2 className="mr-1 h-3 w-3" />
                            彻底删除
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 text-sm text-muted-foreground">共 {items.length} 条记录</div>

        <ResponsiveDialog
          open={restoreDialogOpen}
          onOpenChange={setRestoreDialogOpen}
          title="确认恢复"
          modal
          footer={
            <>
              <Button variant="outline" onClick={() => setRestoreDialogOpen(false)}>
                取消
              </Button>
              <Button onClick={handleRestore} data-testid="confirm-restore-btn">
                确认恢复
              </Button>
            </>
          }
        >
          <p className="py-4 text-muted-foreground">
            确定要恢复{selectedItem?.moduleType}{' '}
            <span className="font-medium text-foreground">{selectedItem?.name}</span> 吗？
            恢复后将重新显示在列表中。
          </p>
        </ResponsiveDialog>

        <ResponsiveDialog
          open={permanentDeleteDialogOpen}
          onOpenChange={setPermanentDeleteDialogOpen}
          title="永久删除"
          modal
          footer={
            <>
              <Button variant="outline" onClick={() => setPermanentDeleteDialogOpen(false)}>
                取消
              </Button>
              <Button
                variant="destructive"
                onClick={handlePermanentDelete}
                data-testid="confirm-permanent-delete-btn"
              >
                永久删除
              </Button>
            </>
          }
        >
          <p className="py-4 text-muted-foreground">
            确定要永久删除{selectedItem?.moduleType}{' '}
            <span className="font-medium text-foreground">{selectedItem?.name}</span> 吗？
            <span className="mt-2 block font-medium text-destructive">此操作不可撤销!</span>
          </p>
        </ResponsiveDialog>
      </StandardLayout>
    </MobileBottomBarSpacer>
  );
}
