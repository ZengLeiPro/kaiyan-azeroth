import {
  PROJECT_TICKET_PRIORITY_OPTIONS,
  PROJECT_TICKET_TYPE_OPTIONS,
} from '@ky-azeroth/shared/constants/project-ticket-constants';
import { format } from 'date-fns';
import { ReactNode } from 'react';

import { EmployeeSelect } from '@/components/patterns/employee-select';
import { FormDialog } from '@/components/patterns/form-dialog';
import { FormField } from '@/components/patterns/form-field';
import { MultiFileUpload } from '@/components/patterns/multi-file-upload';
import { ProjectSelect } from '@/components/patterns/project-select';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { downloadAuthenticatedFile } from '@/hooks/use-authenticated-file';
import { useFileUpload } from '@/hooks/use-file-upload';
import { logger } from '@/lib/logger';

import type { ProjectTicketFormData, ProjectTicketProfile } from '../types';
import { TicketPriorityBadge, TicketStatusBadge, TicketTypeBadge } from './TicketStatusBadge';

export interface TicketFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'view' | 'edit' | 'create';
  title: string;
  loading?: boolean;
  formData: ProjectTicketFormData;
  editingEntity: ProjectTicketProfile | null;
  onModeChange?: () => void;
  onSubmit: () => unknown;
  onDelete?: () => unknown;
  viewHeaderActions?: ReactNode;
  updateField: <K extends keyof ProjectTicketFormData>(
    field: K,
    value: ProjectTicketFormData[K]
  ) => void;
  getFieldError: (field: keyof ProjectTicketFormData) => string | undefined;
}

function parseDateString(value?: string | null): Date | undefined {
  if (!value) return undefined;
  if (!value.includes('T')) {
    const [year, month, day] = value.split('-').map(Number);
    if (!year || !month || !day) return undefined;
    return new Date(year, month - 1, day);
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function formatDateTime(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return format(date, 'yyyy-MM-dd HH:mm');
}

function formatDateOnly(value?: string | null): string {
  if (!value) return '-';
  const date = parseDateString(value);
  if (!date) return value;
  return format(date, 'yyyy-MM-dd');
}

function AttachmentDownloadButton({
  downloadUrl,
  filename,
}: {
  downloadUrl?: string;
  filename: string;
}) {
  return (
    <button
      type="button"
      disabled={!downloadUrl}
      onClick={() => {
        void downloadAuthenticatedFile(downloadUrl, filename).catch((error: unknown) => {
          logger.error('TicketFormDialog', 'Attachment download failed:', error);
        });
      }}
      className={`block max-w-full truncate text-sm ${
        downloadUrl
          ? 'cursor-pointer text-primary hover:underline'
          : 'cursor-not-allowed text-muted-foreground'
      }`}
    >
      {filename}
    </button>
  );
}

export function TicketFormDialog({
  open,
  onOpenChange,
  mode,
  title,
  loading,
  formData,
  editingEntity,
  onModeChange,
  onSubmit,
  onDelete,
  viewHeaderActions,
  updateField,
  getFieldError,
}: TicketFormDialogProps) {
  const { uploadFile } = useFileUpload();
  const isView = mode === 'view';

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      mode={mode}
      onModeChange={onModeChange}
      onSubmit={onSubmit}
      onDelete={onDelete}
      viewHeaderActions={viewHeaderActions}
      loading={loading}
      variant="drawer"
    >
      {isView && editingEntity && (
        <div className="col-span-1 space-y-4 rounded-lg border bg-muted/30 px-4 py-3 md:col-span-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">
              {editingEntity.ticketNo}
            </span>
            <TicketStatusBadge status={editingEntity.status} />
            <TicketTypeBadge type={editingEntity.ticketType} />
            <TicketPriorityBadge priority={editingEntity.priority} />
            {editingEntity.isOverdue && (
              <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                已超期
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-muted-foreground">派单人：</span>
              {editingEntity.dispatcher?.name ?? '-'}
            </div>
            <div>
              <span className="text-muted-foreground">接单人：</span>
              {editingEntity.assignee?.name ?? '-'}
            </div>
            <div>
              <span className="text-muted-foreground">开始于：</span>
              {formatDateTime(editingEntity.startedAt)}
            </div>
            <div>
              <span className="text-muted-foreground">完成于：</span>
              {formatDateTime(editingEntity.completedAt)}
            </div>
            <div>
              <span className="text-muted-foreground">关闭于：</span>
              {formatDateTime(editingEntity.closedAt)}
            </div>
            <div>
              <span className="text-muted-foreground">取消于：</span>
              {formatDateTime(editingEntity.cancelledAt)}
            </div>
            {editingEntity.completionNote && (
              <div className="col-span-2">
                <span className="text-muted-foreground">完成说明：</span>
                <div className="mt-1 whitespace-pre-wrap">{editingEntity.completionNote}</div>
              </div>
            )}
            {editingEntity.closeNote && (
              <div className="col-span-2">
                <span className="text-muted-foreground">关闭说明：</span>
                <div className="mt-1 whitespace-pre-wrap">{editingEntity.closeNote}</div>
              </div>
            )}
            {editingEntity.cancelReason && (
              <div className="col-span-2">
                <span className="text-muted-foreground">取消原因：</span>
                <div className="mt-1 whitespace-pre-wrap">{editingEntity.cancelReason}</div>
              </div>
            )}
          </div>
        </div>
      )}

      <FormField
        name="projectId"
        label="所属项目"
        required
        error={getFieldError('projectId')}
        viewContent={editingEntity?.project?.name}
      >
        <ProjectSelect
          value={formData.projectId}
          onChange={(v) => updateField('projectId', v)}
          placeholder="搜索并选择项目"
          showCustomerInLabel
        />
      </FormField>

      <FormField
        name="title"
        label="工单标题"
        required
        error={getFieldError('title')}
        viewContent={formData.title}
      >
        <Input
          id="title"
          placeholder="请输入工单标题"
          value={formData.title}
          onChange={(e) => updateField('title', e.target.value)}
        />
      </FormField>

      <FormField
        name="ticketType"
        label="工单类型"
        required
        error={getFieldError('ticketType')}
        viewContent={<TicketTypeBadge type={formData.ticketType} />}
      >
        <Select
          options={PROJECT_TICKET_TYPE_OPTIONS}
          value={formData.ticketType}
          onValueChange={(v) => updateField('ticketType', v)}
        />
      </FormField>

      <FormField
        name="priority"
        label="优先级"
        required
        error={getFieldError('priority')}
        viewContent={<TicketPriorityBadge priority={formData.priority} />}
      >
        <Select
          options={PROJECT_TICKET_PRIORITY_OPTIONS}
          value={formData.priority}
          onValueChange={(v) => updateField('priority', v)}
        />
      </FormField>

      <FormField
        name="assigneeId"
        label="接单人"
        required
        error={getFieldError('assigneeId')}
        viewContent={editingEntity?.assignee?.name}
      >
        <EmployeeSelect
          value={formData.assigneeId}
          onChange={(v) => updateField('assigneeId', v)}
          placeholder="搜索并选择接单人"
        />
      </FormField>

      <FormField
        name="dueDate"
        label="截止时间"
        error={getFieldError('dueDate')}
        viewContent={formatDateOnly(formData.dueDate)}
      >
        <DatePicker
          date={parseDateString(formData.dueDate)}
          onDateChange={(date) => updateField('dueDate', date ? format(date, 'yyyy-MM-dd') : null)}
          placeholder="选择截止时间"
          className="w-full"
        />
      </FormField>

      <FormField
        name="description"
        label="详细描述"
        required
        fullRow
        error={getFieldError('description')}
        viewContent={
          formData.description ? (
            <div className="whitespace-pre-wrap">{formData.description}</div>
          ) : undefined
        }
      >
        <Textarea
          id="description"
          placeholder="请详细描述问题或需求"
          value={formData.description}
          onChange={(e) => updateField('description', e.target.value)}
          rows={6}
        />
      </FormField>

      <FormField
        name="attachments"
        label="附件"
        fullRow
        error={getFieldError('attachments')}
        viewContent={
          formData.attachments && formData.attachments.length > 0 ? (
            <div className="space-y-1">
              {formData.attachments.map((file) => (
                <AttachmentDownloadButton
                  key={file.id ?? file.url}
                  downloadUrl={file.downloadUrl}
                  filename={file.name}
                />
              ))}
            </div>
          ) : undefined
        }
      >
        <MultiFileUpload
          value={formData.attachments ?? []}
          onChange={(files) => updateField('attachments', files.length > 0 ? files : null)}
          onUpload={uploadFile}
          disabled={isView}
        />
      </FormField>
    </FormDialog>
  );
}
