/**
 * 待我审批卡片（从 DashboardPage 内联局部组件抽出，结构照抄，未改行为）。
 * 抽出原因：DashboardPage 持续膨胀，且本卡与销售作战两卡并列，统一放 pages/dashboard/components。
 */
import { APPROVAL_EVENT_TYPE_LABELS } from '@ky-azeroth/shared/constants';
import type { IApprovalInstanceResponse, IApprovalTaskResponse } from '@ky-azeroth/shared/types';
import { format } from 'date-fns';
import { ArrowRight, CheckCircle, Inbox, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ApprovalDetailDrawer } from '@/components/patterns/approval-detail-drawer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { api } from '@/lib/api';

// 待我审批卡片：最多加载 100 条，卡片内部滚动展示
const PENDING_APPROVAL_LIMIT = 100;

// 待审批列表项：Task（带 instance）或 Instance（管理员可能直接看到）
type PendingApprovalItem = IApprovalTaskResponse | IApprovalInstanceResponse;

function isTaskItem(item: PendingApprovalItem): item is IApprovalTaskResponse {
  return 'instance' in item && !!(item as IApprovalTaskResponse).instance;
}

function getApprovalInstance(item: PendingApprovalItem): IApprovalInstanceResponse | undefined {
  return isTaskItem(item) ? item.instance : item;
}

export function PendingApprovalsCard() {
  const navigate = useNavigate();
  const [items, setItems] = useState<PendingApprovalItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);

  const fetchPending = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/approvals/pending', {
        params: { page: 1, pageSize: PENDING_APPROVAL_LIMIT },
      });
      setItems(res.data?.items || []);
      setTotal(res.data?.total ?? 0);
    } catch {
      // 静默处理：无权限或异常时卡片仅展示空态
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPending();
  }, [fetchPending]);

  const goToApprovalList = () => navigate('/approval/list?tab=pending');

  const openApprovalDetail = (item: PendingApprovalItem) => {
    const instance = getApprovalInstance(item);
    if (!instance?.id) return;
    setSelectedInstanceId(instance.id);
    setDrawerOpen(true);
  };

  const handleDrawerOpenChange = (open: boolean) => {
    setDrawerOpen(open);
    if (!open) {
      setSelectedInstanceId(null);
    }
  };

  return (
    <>
      <Card className="h-[460px] border">
        <CardContent className="flex h-full flex-col p-5">
          {/* 头部 */}
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100">
                <CheckCircle className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold">待我审批</h3>
                  {total > 0 && (
                    <Badge variant="destructive" className="h-5 min-w-[20px] px-1.5 text-xs">
                      {total > 99 ? '99+' : total}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">点击审批单查看详情并处理</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={goToApprovalList}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              查看全部
              <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>

          {/* 列表 */}
          {loading ? (
            <div className="flex flex-1 items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center py-8 text-muted-foreground">
              <Inbox className="mb-2 h-10 w-10 opacity-20" />
              <p className="text-sm">暂无待审批</p>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <div className="divide-y">
                {items.map((item, idx) => {
                  const instance = getApprovalInstance(item);
                  const title = instance?.title || '-';
                  const eventType = instance?.eventType;
                  const initiatorName = instance?.initiatorName || '-';
                  const time = isTaskItem(item) ? item.createdAt : instance?.createdAt;
                  return (
                    <button
                      key={instance?.id || idx}
                      type="button"
                      onClick={() => openApprovalDetail(item)}
                      className="flex w-full cursor-pointer items-center gap-3 py-3 text-left transition-colors hover:bg-accent/50"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{title}</span>
                          {eventType && (
                            <Badge variant="outline" className="shrink-0 text-[10px]">
                              {APPROVAL_EVENT_TYPE_LABELS[eventType] || eventType}
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {initiatorName} &middot;{' '}
                          {time ? format(new Date(time), 'yyyy-MM-dd HH:mm') : '-'}
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <ApprovalDetailDrawer
        open={drawerOpen}
        onOpenChange={handleDrawerOpenChange}
        instanceId={selectedInstanceId}
        onSuccess={fetchPending}
      />
    </>
  );
}
