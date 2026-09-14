import { APPROVAL_TASK_STATUS_LABELS } from '@ky-azeroth/shared/constants';
import type { IApprovalRecordResponse, IApprovalTaskResponse } from '@ky-azeroth/shared/types';
import { format } from 'date-fns';
import { CheckCircle, Circle, Clock, User, XCircle } from 'lucide-react';

import { cn } from '@/lib/utils';

interface ApprovalTimelineProps {
  records: IApprovalRecordResponse[];
  tasks: IApprovalTaskResponse[];
  currentNode: number;
  totalNodes: number;
  instanceStatus: 'pending' | 'approved' | 'rejected' | 'withdrawn' | string;
}

interface TimelineItem {
  type: 'submit' | 'node';
  nodeOrder: number;
  nodeName?: string;
  status: 'completed' | 'current' | 'pending' | 'rejected';
  records: IApprovalRecordResponse[];
  tasks: IApprovalTaskResponse[];
}

export function ApprovalTimeline({
  records,
  tasks,
  currentNode,
  totalNodes,
  instanceStatus,
}: ApprovalTimelineProps) {
  // 按节点分组任务
  const tasksByNode = tasks.reduce(
    (acc, task) => {
      const nodeOrder = task.nodeOrder;
      if (!acc[nodeOrder]) {
        acc[nodeOrder] = [];
      }
      acc[nodeOrder]!.push(task);
      return acc;
    },
    {} as Record<number, IApprovalTaskResponse[]>
  );

  // 构建时间线项
  const timelineItems: TimelineItem[] = [];

  // 添加提交记录
  const submitRecord = records.find((r) => r.action === 'submit');
  if (submitRecord) {
    timelineItems.push({
      type: 'submit',
      nodeOrder: 0,
      status: 'completed',
      records: [submitRecord],
      tasks: [],
    });
  }

  // 添加各节点
  for (let i = 1; i <= totalNodes; i++) {
    const nodeTasks = tasksByNode[i] || [];
    const nodeRecords = records.filter((r) => r.nodeOrder === i);

    let status: 'completed' | 'current' | 'pending' | 'rejected' = 'pending';
    const hasRejected = nodeTasks.some((t) => t.status === 'rejected');

    if (hasRejected) {
      // 节点内出现驳回，无论实例终态如何都标红
      status = 'rejected';
    } else if (i < currentNode) {
      status = 'completed';
    } else if (i === currentNode) {
      // 后端在最终通过/驳回/撤回时不会推进 currentNode，
      // 因此当前节点的展示必须依据实例终态判定，否则会一直显示"当前节点"黄色闪烁。
      if (instanceStatus === 'approved') {
        status = 'completed';
      } else if (instanceStatus === 'pending') {
        status = 'current';
      } else {
        // rejected（节点 tasks 中无 rejected 的极少数情况）/ withdrawn / 其他终态
        status = 'pending';
      }
    }

    timelineItems.push({
      type: 'node',
      nodeOrder: i,
      nodeName: nodeTasks[0]?.nodeName || `节点 ${i}`,
      status,
      records: nodeRecords,
      tasks: nodeTasks,
    });
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-5 w-5 text-white" />;
      case 'rejected':
        return <XCircle className="h-5 w-5 text-white" />;
      case 'current':
        return <Clock className="h-5 w-5 text-white" />;
      default:
        return <Circle className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-primary';
      case 'rejected':
        return 'bg-destructive';
      case 'current':
        return 'bg-warning animate-pulse';
      default:
        return 'bg-muted';
    }
  };

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex min-w-max items-start md:min-w-0">
        {timelineItems.map((item, index) => (
          <div
            key={item.nodeOrder}
            className="relative flex w-[190px] shrink-0 flex-col items-center px-3 md:flex-1"
          >
            {index < timelineItems.length - 1 && (
              <div
                className={cn(
                  'absolute left-1/2 top-5 h-0.5 w-full',
                  item.status === 'completed' ? 'bg-primary' : 'bg-muted'
                )}
              />
            )}
            <div
              className={cn(
                'relative z-10 flex h-10 w-10 items-center justify-center rounded-full',
                getStatusColor(item.status)
              )}
            >
              {item.type === 'submit' ? (
                <User className="h-5 w-5 text-white" />
              ) : (
                getStatusIcon(item.status)
              )}
            </div>
            <div className="mt-3 w-full pb-1 text-center">
              <div className="mb-1 flex flex-col items-center gap-1">
                <span className="font-medium">
                  {item.type === 'submit' ? '提交审批' : item.nodeName}
                </span>
                {item.status === 'current' && (
                  <span className="rounded bg-warning/10 px-2 py-0.5 text-xs text-warning">
                    当前节点
                  </span>
                )}
              </div>

              {/* 审批任务列表 */}
              {item.tasks.length > 0 && (
                <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {item.tasks.map((task) => (
                    <div key={task.id} className="flex flex-wrap items-center justify-center gap-2">
                      <span>{task.approverName}</span>
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5 text-xs',
                          task.status === 'approved' && 'bg-primary/10 text-primary',
                          task.status === 'rejected' && 'bg-destructive/10 text-destructive',
                          task.status === 'pending' && 'bg-muted text-muted-foreground',
                          task.status === 'skipped' && 'bg-muted text-muted-foreground line-through'
                        )}
                      >
                        {APPROVAL_TASK_STATUS_LABELS[task.status] || task.status}
                      </span>
                      {task.comment && (
                        <span className="text-muted-foreground">"{task.comment}"</span>
                      )}
                      {task.actionTime && (
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(task.actionTime), 'yyyy-MM-dd HH:mm')}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* 提交记录 */}
              {item.type === 'submit' && item.records[0] && (
                <div className="mt-1 text-sm text-muted-foreground">
                  <span>{item.records[0].operatorName}</span>
                  <span className="ml-2 text-xs">
                    {item.records[0].createdAt &&
                      format(new Date(item.records[0].createdAt), 'yyyy-MM-dd HH:mm')}
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
