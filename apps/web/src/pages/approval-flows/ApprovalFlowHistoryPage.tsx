import { APPROVAL_EVENT_TYPE_LABELS } from '@ky-azeroth/shared/constants';
import { format } from 'date-fns';
import { ArrowLeft, Eye, Loader2, PowerOff, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { ResponsiveDialog } from '@/components/mobile/ResponsiveDialog';
import { GenericMobileCard } from '@/components/patterns/generic-mobile-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useIsMobile } from '@/hooks/use-mobile';
import { api, getErrorMessage } from '@/lib/api';

import { type ApprovalFlowProfile, formatVersion, toApprovalFlowProfile } from './types';

export function ApprovalFlowHistoryPage() {
  const navigate = useNavigate();
  const { groupId } = useParams<{ groupId: string }>();
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [versions, setVersions] = useState<ApprovalFlowProfile[]>([]);
  const [activating, setActivating] = useState<string | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<ApprovalFlowProfile | null>(null);
  const [deactivating, setDeactivating] = useState(false);

  // Load version history
  const loadHistory = useCallback(async () => {
    if (!groupId) return;
    try {
      setLoading(true);
      const response = await api.get(`/approval-flows/history/${groupId}`);
      const items = (response.data || []).map(toApprovalFlowProfile);
      setVersions(items);
    } catch (error) {
      toast.error(getErrorMessage(error, '加载版本历史失败'));
      navigate('/approval/flows');
    } finally {
      setLoading(false);
    }
  }, [groupId, navigate]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Handle back
  const handleBack = () => {
    navigate('/approval/flows');
  };

  // Handle view flow
  const handleView = (flow: ApprovalFlowProfile) => {
    navigate(`/approval/flows/${flow.id}`);
  };

  // Handle activate version
  const handleActivate = async (flow: ApprovalFlowProfile) => {
    if (flow.status === 'active') return;

    try {
      setActivating(flow.id);
      await api.post(`/approval-flows/${flow.id}/activate`);
      toast.success(`已激活版本 ${formatVersion(flow.version)}`);
      loadHistory();
    } catch (error) {
      toast.error(getErrorMessage(error, '激活失败'));
    } finally {
      setActivating(null);
    }
  };

  // Handle deactivate (only for currently active version)
  const handleConfirmDeactivate = async () => {
    if (!deactivateTarget) return;
    try {
      setDeactivating(true);
      await api.post(`/approval-flows/${deactivateTarget.id}/deactivate`);
      toast.success(`已停用版本 ${formatVersion(deactivateTarget.version)}`);
      setDeactivateTarget(null);
      loadHistory();
    } catch (error) {
      toast.error(getErrorMessage(error, '停用失败'));
    } finally {
      setDeactivating(false);
    }
  };

  // Get status badge
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge variant="success">当前版本</Badge>;
      case 'inactive':
        return <Badge variant="secondary">历史版本</Badge>;
      case 'deleted':
        return <Badge variant="destructive">已删除</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const eventType = versions[0]?.eventType;
  const eventTypeName = eventType ? APPROVAL_EVENT_TYPE_LABELS[eventType] || eventType : '';

  // Render mobile card
  const renderMobileCard = (flow: ApprovalFlowProfile) => (
    <GenericMobileCard
      title={flow.name}
      status={getStatusBadge(flow.status)}
      fields={[
        { label: '版本', value: formatVersion(flow.version) },
        { label: '节点数', value: flow.nodes?.length || 0 },
      ]}
      footer={flow.createdAt ? format(new Date(flow.createdAt), 'yyyy-MM-dd HH:mm') : '-'}
      onClick={() => handleView(flow)}
      testId={`version-${flow.id}`}
    >
      {flow.status === 'inactive' && (
        <div className="mt-2 flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              handleActivate(flow);
            }}
            disabled={activating === flow.id}
          >
            {activating === flow.id ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            )}
            回滚此版本
          </Button>
        </div>
      )}
      {flow.status === 'active' && (
        <div className="mt-2 flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setDeactivateTarget(flow);
            }}
          >
            <PowerOff className="mr-1.5 h-3.5 w-3.5" />
            停用当前版本
          </Button>
        </div>
      )}
    </GenericMobileCard>
  );

  return (
    <div className="flex h-full flex-col p-4 md:p-6">
      {/* Header */}
      <div className="mb-4 flex items-center gap-3 md:mb-6">
        <Button variant="ghost" size="icon" onClick={handleBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-xl font-semibold md:text-2xl">版本历史</h1>
          <p className="mt-0.5 text-xs text-muted-foreground md:mt-1 md:text-sm">
            {eventTypeName} 审批流程的所有版本
          </p>
        </div>
      </div>

      {/* Version list */}
      <div className="flex-1 overflow-auto">
        {isMobile ? (
          // Mobile view: card list
          <div className="space-y-3">
            {versions.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">暂无版本记录</div>
            ) : (
              versions.map((flow) => <div key={flow.id}>{renderMobileCard(flow)}</div>)
            )}
          </div>
        ) : (
          // Desktop view: table
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">版本</TableHead>
                <TableHead>流程名称</TableHead>
                <TableHead className="w-28">状态</TableHead>
                <TableHead className="w-24">节点数</TableHead>
                <TableHead className="w-40">创建时间</TableHead>
                <TableHead className="w-32">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {versions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    暂无版本记录
                  </TableCell>
                </TableRow>
              ) : (
                versions.map((flow) => (
                  <TableRow
                    key={flow.id}
                    className="cursor-pointer"
                    onClick={() => handleView(flow)}
                  >
                    <TableCell>
                      <Badge variant="outline" className="font-mono">
                        {formatVersion(flow.version)}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">{flow.name}</TableCell>
                    <TableCell>{getStatusBadge(flow.status)}</TableCell>
                    <TableCell>{flow.nodes?.length || 0}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {flow.createdAt ? format(new Date(flow.createdAt), 'yyyy-MM-dd HH:mm') : '-'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleView(flow)}
                          title="查看详情"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {flow.status === 'inactive' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleActivate(flow)}
                            disabled={activating === flow.id}
                            title="回滚到此版本"
                          >
                            {activating === flow.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RotateCcw className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                        {flow.status === 'active' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeactivateTarget(flow)}
                            title="停用当前版本"
                          >
                            <PowerOff className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </div>

      <ResponsiveDialog
        open={!!deactivateTarget}
        onOpenChange={(open) => !open && setDeactivateTarget(null)}
        title="停用当前版本"
        desktopMaxWidth="max-w-sm"
        modal
        footer={
          <>
            <Button variant="outline" onClick={() => setDeactivateTarget(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleConfirmDeactivate} disabled={deactivating}>
              {deactivating ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  处理中...
                </>
              ) : (
                '确认停用'
              )}
            </Button>
          </>
        }
      >
        {deactivateTarget && (
          <div className="py-4 text-sm text-muted-foreground">
            确定停用{' '}
            <span className="font-medium text-foreground">
              {deactivateTarget.name}（{formatVersion(deactivateTarget.version)}）
            </span>{' '}
            吗？
            <br />
            停用后该 <span className="font-medium text-foreground">{eventTypeName}</span>{' '}
            模块将暂无激活流程，新提交的审批事件不再走此流程；已在进行中的实例不受影响，继续按快照跑完。
          </div>
        )}
      </ResponsiveDialog>
    </div>
  );
}

export default ApprovalFlowHistoryPage;
