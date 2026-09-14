import { ReactNode, useMemo, useState } from 'react';

import {
  type RelatedEntityColumn,
  RelatedEntityList,
} from '@/components/patterns/related-entity-list';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDateDisplay } from '@/lib/date-utils';

import { TicketPriorityBadge, TicketStatusBadge } from '../../tickets/components/TicketStatusBadge';

interface ProjectDrawerBodyProps {
  projectId: string;
  /** 第一 tab "基本信息" 的内容（沿用页面原 fields + 描述区域） */
  fieldsContent: ReactNode;
  /** 成员管理区域（沿用页面原 ProjectMemberSection 实例） */
  memberSection?: ReactNode;
}

interface TicketRow {
  id: string;
  ticketNo: string;
  title: string;
  status: string;
  priority: string;
  assignee?: { name?: string | null } | null;
  dueDate?: string | null;
}

interface EffortRow {
  id: string;
  workDate?: string | null;
  startDate?: string | null;
  actualTime: number;
  ownerName?: string | null;
  description?: string | null;
}

const truncate = (s: string | null | undefined, n = 24) =>
  !s ? '-' : s.length > n ? `${s.slice(0, n)}...` : s;

/**
 * 项目详情 Drawer 在查看模式下的完整内容（含 Tabs）。
 *
 * 4 个 Tab：基本信息 | 工单 | 工时 | 成员
 *
 * 第一个 tab 渲染 `fieldsContent`（来自页面原表单字段）；
 * "工单" 和 "工时" tab 内嵌 RelatedEntityList，按 projectId 拉取关联数据；
 * "成员" tab 沿用页面已有的 ProjectMemberSection 实例（通过 `memberSection` prop）。
 */
export function ProjectDrawerBody({
  projectId,
  fieldsContent,
  memberSection,
}: ProjectDrawerBodyProps) {
  const [tab, setTab] = useState('info');

  const ticketColumns = useMemo<RelatedEntityColumn<TicketRow>[]>(
    () => [
      { key: 'ticketNo', header: '编号', className: 'font-mono text-xs' },
      {
        key: 'title',
        header: '标题',
        render: (r) => <span className="font-medium">{truncate(r.title, 30)}</span>,
      },
      { key: 'status', header: '状态', render: (r) => <TicketStatusBadge status={r.status} /> },
      {
        key: 'priority',
        header: '优先级',
        render: (r) => <TicketPriorityBadge priority={r.priority} />,
      },
      { key: 'assignee', header: '接单人', render: (r) => r.assignee?.name || '-' },
      {
        key: 'dueDate',
        header: '截止',
        render: (r) => formatDateDisplay(r.dueDate) || '-',
      },
    ],
    []
  );

  const effortColumns = useMemo<RelatedEntityColumn<EffortRow>[]>(
    () => [
      {
        key: 'workDate',
        header: '日期',
        render: (r) => formatDateDisplay(r.workDate || r.startDate) || '-',
      },
      {
        key: 'actualTime',
        header: '工时',
        className: 'text-right font-mono',
        render: (r) => Number(r.actualTime ?? 0).toFixed(1),
      },
      { key: 'ownerName', header: '记录人', render: (r) => r.ownerName || '-' },
      {
        key: 'description',
        header: '工时描述',
        render: (r) => (
          <span className="text-muted-foreground" title={r.description ?? undefined}>
            {truncate(r.description, 30)}
          </span>
        ),
      },
    ],
    []
  );

  return (
    // col-span-1 md:col-span-2：撑满父级 FormDialog 的 grid-cols-2 容器，
    // 否则整个 Tabs 会被当作一个 grid 单元格挤在左列、右列空白。
    <Tabs value={tab} onValueChange={setTab} className="col-span-1 md:col-span-2">
      <TabsList className="flex w-full justify-start gap-1 overflow-x-auto whitespace-nowrap">
        <TabsTrigger value="info">基本信息</TabsTrigger>
        <TabsTrigger value="tickets">工单</TabsTrigger>
        <TabsTrigger value="efforts">工时</TabsTrigger>
        {memberSection && <TabsTrigger value="members">成员</TabsTrigger>}
      </TabsList>

      <TabsContent value="info">{fieldsContent}</TabsContent>

      <TabsContent value="tickets">
        <RelatedEntityList<TicketRow>
          endpoint="/project-tickets"
          queryParams={{ projectId, sortBy: 'createdAt', sortOrder: 'desc' }}
          columns={ticketColumns}
          emptyHint="该项目暂无工单"
          targetRoute="/projects/tickets"
        />
      </TabsContent>

      <TabsContent value="efforts">
        <RelatedEntityList<EffortRow>
          endpoint="/effort-records"
          queryParams={{ projectId, sortBy: 'startDate', sortOrder: 'desc' }}
          columns={effortColumns}
          emptyHint="该项目暂无工时记录"
          targetRoute="/projects/effort-records"
        />
      </TabsContent>

      {memberSection && <TabsContent value="members">{memberSection}</TabsContent>}
    </Tabs>
  );
}
